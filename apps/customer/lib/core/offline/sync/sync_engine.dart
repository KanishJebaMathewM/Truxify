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
  }) : resolver = resolver ?? ConflictResolver();

  final OfflineEventDb db;
  final String apiBaseUrl;
  final ConflictResolver resolver;
  final int maxRetries;
  final int batchSize;

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
    final pending = await db.pendingEvents(limit: batchSize);
    final eligible = pending.where((event) => event.retryCount < maxRetries).toList();
    if (eligible.isEmpty) {
      return 0;
    }

    final resolved = resolver.resolve(eligible);
    if (resolved.isEmpty) {
      return 0;
    }

    await _markAsSyncing(resolved);

    final uploadOutcome = await _uploadBatch(resolved);
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
      final session = Supabase.instance.client.auth.currentSession;
      final token = session?.accessToken;

      if (token == null) {
        developer.log('[SyncEngine] ⚠️ Cannot sync batch: User session token is null/expired.');
        return SyncUploadOutcome.retryableFailure;
      }

      final response = await http.post(
        Uri.parse('$apiBaseUrl/api/v1/trips/events/batch'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token', // ✅ INJECT ACCESS TOKEN
        },
        body: body,
      ).timeout(AppConfig.syncTimeout);

      if (response.statusCode == 200 || response.statusCode == 202) {
        return SyncUploadOutcome.success;
      }

      if (response.statusCode == 401) {
        developer.log('[SyncEngine] 🚨 Auth rejected by server (401 Unauthorized).');
        return SyncUploadOutcome.retryableFailure;
      }

      if (response.statusCode == 409 || response.statusCode == 422 || response.statusCode == 400) {
        return SyncUploadOutcome.permanentFailure;
      }

      if (response.statusCode == 429 || response.statusCode >= 500) {
        await Future<void>.delayed(_backoffDelay(_maxRetryCount(events)));
        return SyncUploadOutcome.retryableFailure;
      }

      return SyncUploadOutcome.retryableFailure;
    } catch (_) {
      await Future<void>.delayed(_backoffDelay(_maxRetryCount(events)));
      return SyncUploadOutcome.retryableFailure;
    }
  }

  int _maxRetryCount(List<TripEvent> events) {
    return events.map((event) => event.retryCount).reduce((value, element) => value > element ? value : element);
  }

  String _idempotencyKeyFor(List<TripEvent> events) {
    final ids = events.map((event) => event.id).toList()..sort();
    return ids.join(',');
  }

  Duration _backoffDelay(int retryCount) {
    final delayMs = 250 * (1 << (retryCount.clamp(0, 5)));
    return Duration(milliseconds: delayMs > 8000 ? 8000 : delayMs);
  }
}
