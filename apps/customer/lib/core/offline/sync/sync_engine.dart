import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;
import '../../config.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart'; // ✅ IMPORT SUPABASE
import '../conflict/conflict_resolver.dart';
import '../db/offline_event_db.dart';
import '../models/trip_event.dart';

enum SyncUploadOutcome {
  success,
  retryableFailure,
  permanentFailure,
}

class SyncEngine {
  SyncEngine({
    required this.db,
    required this.apiBaseUrl,
    ConflictResolver? resolver,
    this.maxRetries = 5,
    this.batchSize = 20,
    this.httpClient = _defaultHttpClient,
    this.getCurrentToken = _defaultGetCurrentToken,
    this.refreshAuthToken = _defaultRefreshAuthToken,
  }) : resolver = resolver ?? ConflictResolver();

  final OfflineEventDb db;
  final String apiBaseUrl;
  final ConflictResolver resolver;
  final int maxRetries;
  final int batchSize;

  /// HTTP client used for batch uploads. Injected to keep the engine testable.
  final http.Client httpClient;

  /// Returns the current Supabase access token, or null if the session is
  /// missing/expired. Overridable so tests can stub auth state.
  final String? Function() getCurrentToken;

  /// Attempts to refresh the auth session and returns the new access token, or
  /// null if the refresh itself failed. Overridable so tests can stub refresh.
  final Future<String?> Function() refreshAuthToken;

  static http.Client get _defaultHttpClient => http.Client();

  static String? _defaultGetCurrentToken() =>
      Supabase.instance.client.auth.currentSession?.accessToken;

  static Future<String?> _defaultRefreshAuthToken() async {
    final refreshed = await Supabase.instance.client.auth.refreshSession();
    return refreshed.session?.accessToken;
  }

  bool _isSyncing = false;

  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  final Connectivity _connectivity = Connectivity();

  Future<void> startListening() async {
    _connectivitySubscription = _connectivity.onConnectivityChanged.listen((result) {
      final hasNetwork = !result.contains(ConnectivityResult.none);
      if (hasNetwork) {
        unawaited(syncPending());
      }
    });
  }

  Future<void> stopListening() async {
    await _connectivitySubscription?.cancel();
    _connectivitySubscription = null;
  }

  Future<int> syncPending() async {
    if (_isSyncing) return 0;
    _isSyncing = true;
    try {
      return await _syncPendingInternal();
    } finally {
      _isSyncing = false;
    }
  }

  Future<int> _syncPendingInternal() async {
    final pending = await db.pendingEvents(limit: batchSize);
    if (pending.isEmpty) {
      return 0;
    }

    // Events that exhausted their retry budget must never be silently dropped
    // forever: mark them rejected with a stored reason the UI can surface.
    final exhausted = pending
        .where((event) => event.retryCount >= maxRetries)
        .toList();
    if (exhausted.isNotEmpty) {
      for (final event in exhausted) {
        await db.markRejected(event.id, reason: 'retry budget exhausted');
      }
      developer.log(
        '[SyncEngine] Rejected ${exhausted.length} offline event(s) that exhausted their retry budget.',
      );
    }

    final eligible =
        pending.where((event) => event.retryCount < maxRetries).toList();
    if (eligible.isEmpty) {
      return 0;
    }

    final resolution = resolver.resolveWithDetails(eligible);
    final resolved = resolution.resolved;
    final supersededIds = resolution.supersededIds;

    // Clear superseded/deduplicated event IDs from SQLite to prevent orphan pending queue loops
    for (final id in supersededIds) {
      await db.markSynced(id);
    }

    if (resolved.isEmpty) {
      return 0;
    }

    await _markAsSyncing(resolved);

    final SyncUploadOutcome uploadOutcome;
    try {
      uploadOutcome = await _uploadBatch(resolved);
    } catch (e) {
      developer.log('[SyncEngine] Unexpected error during batch upload: $e');
      // An unexpected error during upload must never leave events stuck in the
      // transient `syncing` state; fall through to failure handling below so
      // they are re-queued on a later sync pass.
      uploadOutcome = SyncUploadOutcome.retryableFailure;
    }
    if (uploadOutcome == SyncUploadOutcome.success) {
      for (final event in resolved) {
        await db.markSynced(event.id);
      }
      return resolved.length;
    }

    if (uploadOutcome == SyncUploadOutcome.permanentFailure) {
      for (final event in resolved) {
        await db.markRejected(event.id, reason: 'Server rejected this offline event batch as non-retryable.');
      }
      return 0;
    }

    for (final event in resolved) {
      await db.markFailed(event.id, retryCount: event.retryCount + 1);
    }
    return 0;
  }

  Future<void> _markAsSyncing(List<TripEvent> events) async {
    for (final event in events) {
      await db.markSyncing(event.id);
    }
  }

  Future<SyncUploadOutcome> _uploadBatch(List<TripEvent> events) async {
    final body = jsonEncode({
      'events': events.map((event) => event.toJson()).toList(),
      'idempotencyKey': _idempotencyKeyFor(events),
    });

    try {
      // 🚀 AUTH EXTRACTION (Issue #361/#362 Fix)
      // Grab the fresh active Supabase JWT token from the local client session
      final token = getCurrentToken();

      if (token == null) {
        developer.log('[SyncEngine] ⚠️ Cannot sync batch: User session token is null/expired.');
        return SyncUploadOutcome.retryableFailure;
      }

      final response = await _postBatch(body, token);

      if (response.statusCode == 200 || response.statusCode == 202) {
        return SyncUploadOutcome.success;
      }

      // 🔐 Issue #11487: a 401 means the access token expired. Refresh the
      // session and retry ONCE with the new token instead of blindly retrying
      // against a dead token. Only a failed refresh is terminal, so a merely
      // expired token can never permanently discard queued trip events.
      if (response.statusCode == 401) {
        developer.log('[SyncEngine] 🚨 Auth rejected by server (401 Unauthorized). Refreshing token and retrying.');
        final newToken = await refreshAuthToken();
        if (newToken == null) {
          developer.log('[SyncEngine] ❌ Token refresh failed; marking batch as permanently failed.');
          return SyncUploadOutcome.permanentFailure;
        }
        final retry = await _postBatch(body, newToken);
        if (retry.statusCode == 200 || retry.statusCode == 202) {
          return SyncUploadOutcome.success;
        }
        return SyncUploadOutcome.permanentFailure;
      }

      if (response.statusCode == 409 || response.statusCode == 422 || response.statusCode == 400) {
        return SyncUploadOutcome.permanentFailure;
      }

      if (response.statusCode == 429 || response.statusCode >= 500) {
        await Future<void>.delayed(_backoffDelay(_maxRetryCount(events)));
        return SyncUploadOutcome.retryableFailure;
      }

      return SyncUploadOutcome.retryableFailure;
    } catch (e) {
      developer.log('[SyncEngine] Batch upload threw: $e');
      await Future<void>.delayed(_backoffDelay(_maxRetryCount(events)));
      return SyncUploadOutcome.retryableFailure;
    }
  }

  Future<http.Response> _postBatch(String body, String token) {
    return httpClient.post(
      Uri.parse('$apiBaseUrl/api/v1/trips/events/batch'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token', // ✅ INJECT ACCESS TOKEN
      },
      body: body,
    ).timeout(AppConfig.syncTimeout);
  }

  int _maxRetryCount(List<TripEvent> events) {
    return events.map((event) => event.retryCount).reduce((value, element) => value > element ? value : element);
  }

  String _idempotencyKeyFor(List<TripEvent> events) {
    final ids = events.map((event) => event.id).toList()..sort();
    return ids.join(',');
  }

  Duration _backoffDelay(int retryCount) {
    final delayMs = 250 * (1 << (retryCount.clamp(0, 5).toInt()));
    return Duration(milliseconds: delayMs > 8000 ? 8000 : delayMs);
  }
}
