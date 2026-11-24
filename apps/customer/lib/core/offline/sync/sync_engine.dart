
import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config.dart';
import '../conflict/conflict_resolver.dart';
import '../db/offline_event_db.dart';
import '../models/trip_event.dart';

enum SyncUploadOutcome {
  success,
  retryableFailure,
  permanentFailure,
  networkUnavailable,
}

class SyncEngine {
  SyncEngine({
    required this.db,
    required this.apiBaseUrl,
    ConflictResolver? resolver,
    this.maxRetries = 5,
    this.batchSize = 20,
    http.Client? httpClient,
    Connectivity? connectivity,
    String? Function()? getCurrentToken,
    Future<String?> Function()? refreshAuthToken,
  })  : resolver = resolver ?? ConflictResolver(),
        httpClient = httpClient ?? http.Client(),
        _ownsHttpClient = httpClient == null,
        getCurrentToken =
            getCurrentToken ?? _defaultGetCurrentToken,
        refreshAuthToken =
            refreshAuthToken ?? _defaultRefreshAuthToken,
        _connectivity = connectivity ?? Connectivity() {
    if (maxRetries < 0) {
      throw ArgumentError.value(maxRetries, 'maxRetries');
    }

    if (batchSize <= 0) {
      throw ArgumentError.value(batchSize, 'batchSize');
    }

    if (apiBaseUrl.trim().isEmpty) {
      throw ArgumentError.value(apiBaseUrl, 'apiBaseUrl');
    }
  }

  final OfflineEventDb db;
  final String apiBaseUrl;
  final ConflictResolver resolver;

  final int maxRetries;
  final int batchSize;

  final http.Client httpClient;
  final bool _ownsHttpClient;

  final String? Function() getCurrentToken;
  final Future<String?> Function() refreshAuthToken;

  final Connectivity _connectivity;

  bool _isSyncing = false;
  bool _disposed = false;

  StreamSubscription<List<ConnectivityResult>>?
      _connectivitySubscription;

  static String? _defaultGetCurrentToken() {
    return Supabase.instance.client.auth.currentSession?.accessToken;
  }

  static Future<String?> _defaultRefreshAuthToken() async {
    final response =
        await Supabase.instance.client.auth.refreshSession();

    return response.session?.accessToken;
  }

  Future<void> startListening() async {
    if (_disposed || _connectivitySubscription != null) return;

    _connectivitySubscription =
        _connectivity.onConnectivityChanged.listen(
      (results) {
        if (results.isNotEmpty &&
            !results.contains(ConnectivityResult.none)) {
          unawaited(syncPending());
        }
      },
      onError: (Object error, StackTrace stackTrace) {
        developer.log(
          '[SyncEngine] Connectivity listener error.',
          error: error,
          stackTrace: stackTrace,
        );
      },
    );

    // Also attempt synchronization when listening starts.
    unawaited(syncPending());
  }

  Future<void> stopListening() async {
    await _connectivitySubscription?.cancel();
    _connectivitySubscription = null;
  }

  Future<void> dispose() async {
    if (_disposed) return;

    _disposed = true;

    await stopListening();

    if (_ownsHttpClient) {
      httpClient.close();
    }
  }

  Future<int> syncPending() async {
    if (_disposed || _isSyncing) return 0;

    _isSyncing = true;

    try {
      return await _syncPendingInternal();
    } catch (error, stackTrace) {
      developer.log(
        '[SyncEngine] Synchronization failed.',
        error: error,
        stackTrace: stackTrace,
      );
      return 0;
    } finally {
      _isSyncing = false;
    }
  }

  Future<int> _syncPendingInternal() async {
    final pending = await db.pendingEvents(limit: batchSize);

    if (pending.isEmpty) return 0;

    // Reject events that have exhausted their retry budget.
    final exhausted = pending
        .where((event) => event.retryCount >= maxRetries)
        .toList();

    for (final event in exhausted) {
      await db.markRejected(
        event.id,
        reason: 'Retry budget exhausted.',
      );
    }

    if (exhausted.isNotEmpty) {
      developer.log(
        '[SyncEngine] Rejected ${exhausted.length} '
        'event(s) after exhausting retries.',
      );
    }

    final eligible = pending
        .where((event) => event.retryCount < maxRetries)
        .toList();

    if (eligible.isEmpty) return 0;

    // Resolve duplicate and conflicting events.
    final resolution = resolver.resolveWithDetails(eligible);

    final resolved = resolution.resolved;
    final supersededIds = resolution.supersededIds;

    // Mark superseded events as handled.
    for (final id in supersededIds) {
      await db.markSynced(id);
    }

    if (resolved.isEmpty) return 0;

    // Mark events as syncing before uploading.
    await _markAsSyncing(resolved);

    SyncUploadOutcome outcome;

    try {
      outcome = await _uploadBatch(resolved);
    } catch (error, stackTrace) {
      developer.log(
        '[SyncEngine] Unexpected batch upload error.',
        error: error,
        stackTrace: stackTrace,
      );

      outcome = SyncUploadOutcome.retryableFailure;
    }

    switch (outcome) {
      case SyncUploadOutcome.success:
        for (final event in resolved) {
          await db.markSynced(event.id);
        }

        developer.log(
          '[SyncEngine] Successfully synced ${resolved.length} events.',
        );

        return resolved.length;

      case SyncUploadOutcome.permanentFailure:
        for (final event in resolved) {
          await db.markRejected(
            event.id,
            reason: 'Server rejected the event as non-retryable.',
          );
        }

        return 0;

      case SyncUploadOutcome.networkUnavailable:
        // Preserve retry count when connectivity or authentication
        // is temporarily unavailable.
        for (final event in resolved) {
          await db.markFailed(
            event.id,
            retryCount: event.retryCount,
          );
        }

        return 0;

      case SyncUploadOutcome.retryableFailure:
        for (final event in resolved) {
          await db.markFailed(
            event.id,
            retryCount: event.retryCount + 1,
          );
        }

        return 0;
    }
  }

  Future<void> _markAsSyncing(List<TripEvent> events) async {
    for (final event in events) {
      await db.markSyncing(event.id);
    }
  }

  Future<SyncUploadOutcome> _uploadBatch(
    List<TripEvent> events,
  ) async {
    final body = jsonEncode({
      'events': events.map((event) => event.toJson()).toList(),
      'idempotencyKey': _idempotencyKeyFor(events),
    });

    try {
      final connectivity = await _connectivity.checkConnectivity();

      if (connectivity.isEmpty ||
          connectivity.contains(ConnectivityResult.none)) {
        developer.log(
          '[SyncEngine] Device is offline. Upload skipped.',
        );

        return SyncUploadOutcome.networkUnavailable;
      }

      // Get the current Supabase access token.
      String? token;

      try {
        token = getCurrentToken();
      } catch (error) {
        developer.log(
          '[SyncEngine] Failed to read authentication token: $error',
        );

        return SyncUploadOutcome.networkUnavailable;
      }

      if (token == null || token.isEmpty) {
        developer.log(
          '[SyncEngine] No active authentication token.',
        );

        return SyncUploadOutcome.networkUnavailable;
      }

      var response = await _postBatch(body, token);

      // Refresh the token and retry once after HTTP 401.
      if (response.statusCode == 401) {
        developer.log(
          '[SyncEngine] Access token expired. Refreshing session.',
        );

        String? newToken;

        try {
          newToken = await refreshAuthToken();
        } catch (error, stackTrace) {
          developer.log(
            '[SyncEngine] Token refresh failed.',
            error: error,
            stackTrace: stackTrace,
          );

          return SyncUploadOutcome.networkUnavailable;
        }

        if (newToken == null || newToken.isEmpty) {
          return SyncUploadOutcome.networkUnavailable;
        }

        response = await _postBatch(body, newToken);
      }

      return _classifyResponse(response, events);
    } on SocketException catch (error) {
      developer.log(
        '[SyncEngine] Network unavailable: $error',
      );

      return SyncUploadOutcome.networkUnavailable;
    } on TimeoutException catch (error) {
      developer.log(
        '[SyncEngine] Upload timed out: $error',
      );

      return SyncUploadOutcome.networkUnavailable;
    } on http.ClientException catch (error) {
      developer.log(
        '[SyncEngine] HTTP client error: $error',
      );

      return SyncUploadOutcome.networkUnavailable;
    } catch (error, stackTrace) {
      developer.log(
        '[SyncEngine] Batch upload failed.',
        error: error,
        stackTrace: stackTrace,
      );

      await Future<void>.delayed(
        _backoffDelay(_maxRetryCount(events)),
      );

      return SyncUploadOutcome.retryableFailure;
    }
  }

  SyncUploadOutcome _classifyResponse(
    http.Response response,
    List<TripEvent> events,
  ) {
    final status = response.statusCode;

    if (status == 200 || status == 202) {
      return SyncUploadOutcome.success;
    }

    if (status == 400 || status == 409 || status == 422) {
      developer.log(
        '[SyncEngine] Permanent server rejection: HTTP $status',
      );

      return SyncUploadOutcome.permanentFailure;
    }

    if (status == 401 || status == 403) {
      developer.log(
        '[SyncEngine] Authentication or authorization failed: '
        'HTTP $status',
      );

      return SyncUploadOutcome.networkUnavailable;
    }

    if (status == 408 || status == 429 || status >= 500) {
      developer.log(
        '[SyncEngine] Temporary server failure: HTTP $status',
      );

      return SyncUploadOutcome.retryableFailure;
    }

    if (status >= 400 && status < 500) {
      return SyncUploadOutcome.permanentFailure;
    }

    return SyncUploadOutcome.retryableFailure;
  }

  Future<http.Response> _postBatch(
    String body,
    String token,
  ) {
    final baseUrl = apiBaseUrl.replaceFirst(
      RegExp(r'/+$'),
      '',
    );

    final uri = Uri.parse(
      '$baseUrl/api/v1/trips/events/batch',
    );

    return httpClient
        .post(
          uri,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': 'Bearer $token',
          },
          body: body,
        )
        .timeout(AppConfig.syncTimeout);
  }

  int _maxRetryCount(List<TripEvent> events) {
    if (events.isEmpty) return 0;

    return events
        .map((event) => event.retryCount)
        .reduce((a, b) => a > b ? a : b);
  }

  String _idempotencyKeyFor(List<TripEvent> events) {
    final ids = events.map((event) => event.id).toList()..sort();

    return ids.join(',');
  }

  Duration _backoffDelay(int retryCount) {
    final exponent = retryCount.clamp(0, 5).toInt();
    final delayMs = 250 * (1 << exponent);

    return Duration(
      milliseconds: delayMs.clamp(250, 8000).toInt(),
    );
  }
}

