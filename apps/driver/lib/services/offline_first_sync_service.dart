import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';
import '../models/offline_sync_event_model.dart';

class OfflineFirstSyncService {
  Database? _db;
  bool _isConnected = false;
  int _idCounter = 0;
  final Random _random = Random();
  final StreamController<bool> _connectionController = StreamController<bool>.broadcast();
  final StreamController<List<OfflineSyncEvent>> _dbController = StreamController<List<OfflineSyncEvent>>.broadcast();

  /// In-flight sync-pass guard: at most one pass runs at a time. Triggers
  /// that arrive mid-pass set [_syncQueued] so a follow-up pass drains any
  /// events queued during the previous one (issue #11712).
  bool _isSyncing = false;
  bool _syncQueued = false;

  /// Hard retry ceiling before an event is dead-lettered (never re-POSTed on
  /// every connectivity change).
  static const int maxRetries = 3;

  /// Event states: pending events are synced, dead-lettered events are
  /// terminal and retained for diagnostics only.
  static const String statePending = 'pending';
  static const String stateDeadLetter = 'dead_letter';

  /// Outcome of a single sync attempt.
  /// - [success]: delivered (2xx / idempotent 409 / 208) — drop the row.
  /// - [retriable]: transient (401/429/5xx/network) — retry, dead-letter only
  ///   after [maxRetries].
  /// - [permanent]: non-retryable 4xx (validation/404) — dead-letter now.
  /// - [unauthorized]: internal marker for a 401, handled by token refresh.
  enum _SyncOutcome { success, retriable, permanent, unauthorized }

  Stream<bool> get connectionStream => _connectionController.stream;
  Stream<List<OfflineSyncEvent>> get databaseStream => _dbController.stream;

  /// Backend base URL, injected at build time via --dart-define.
  /// Mirrors SyncEngine.apiBaseUrl so this service targets the same API host.
  static String get _apiBaseUrl {
    const envUrl = String.fromEnvironment('TRUXIFY_API_BASE_URL');
    if (envUrl.isNotEmpty) return envUrl;
    if (kReleaseMode) throw StateError('TRUXIFY_API_BASE_URL must be set in release mode');

    if (kIsWeb) return 'http://localhost:8080';
    if (Platform.isAndroid) return 'http://10.0.2.2:8080';
    return 'http://localhost:8080';
  }

  OfflineFirstSyncService() {
    // The DB opens lazily; failures are captured inside _initDatabase so this
    // fire-and-forget call never surfaces as an unhandled async error.
    unawaited(_initDatabase());
  }

  Future<void> _initDatabase() async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      final dbPath = p.join(dir.path, 'offline_sync.db');
      _db = await openDatabase(
        dbPath,
        version: 3,
        onCreate: (db, version) async {
          await db.execute('''
            CREATE TABLE sync_events (
              event_id TEXT PRIMARY KEY,
              event_type TEXT NOT NULL,
              payload TEXT NOT NULL,
              queued_at INTEGER NOT NULL,
              is_synced INTEGER NOT NULL DEFAULT 0,
              synced_at INTEGER,
              retry_count INTEGER NOT NULL DEFAULT 0,
              state TEXT NOT NULL DEFAULT 'pending'
            )
          ''');
        },
        onUpgrade: (db, oldVersion, newVersion) async {
          if (oldVersion < 2) {
            await db.execute(
              'ALTER TABLE sync_events ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0',
            );
          }
          if (oldVersion < 3) {
            await db.execute(
              "ALTER TABLE sync_events ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'",
            );
          }
        },
      );
      await _emitDbSnapshot();
    } catch (err, st) {
      // A failed open (e.g. a corrupt DB file on disk) must not crash the app
      // or surface as an unhandled async error; sync simply stays dormant and
      // a later trigger can retry.
      debugPrint('OfflineFirstSyncService: DB init failed: $err\n$st');
    }
  }

  String _generateId() {
    _idCounter++;
    final now = DateTime.now().microsecondsSinceEpoch;
    final rand = _random.nextInt(9999);
    return 'EVT-$now-$_idCounter-$rand';
  }

  Future<void> queueEvent(String type, Map<String, dynamic> data) async {
    final db = _db;
    if (db == null) return;

    final event = OfflineSyncEvent(
      eventId: _generateId(),
      eventType: type,
      payload: data,
      queuedAt: DateTime.now(),
    );

    await db.insert('sync_events', {
      'event_id': event.eventId,
      'event_type': event.eventType,
      'payload': jsonEncode(event.payload),
      'queued_at': event.queuedAt.millisecondsSinceEpoch,
      'is_synced': 0,
      'state': statePending,
    });

    _emitDbSnapshot();

    if (_isConnected) {
      _processSyncQueue();
    }
  }

  void toggleNetwork(bool isOnline) {
    _isConnected = isOnline;
    _connectionController.add(_isConnected);
    if (_isConnected) {
      _processSyncQueue();
    }
  }

  /// Decodes one DB row into an event, or returns null when the row is corrupt
  /// (non-JSON payload, missing/wrong-typed columns). A corrupt row must never
  /// crash a sync pass or the snapshot stream (issue #12138); callers flag it
  /// dead_letter so it stops blocking the queue and remains visible for
  /// diagnostics.
  OfflineSyncEvent? _parseRow(Map<String, dynamic> row) {
    final eventId = row['event_id'];
    final eventType = row['event_type'];
    final payloadRaw = row['payload'];
    final queuedAtRaw = row['queued_at'];
    if (eventId is! String ||
        eventType is! String ||
        payloadRaw is! String ||
        queuedAtRaw is! int) {
      return null;
    }

    Map<String, dynamic>? payload;
    try {
      final decoded = jsonDecode(payloadRaw);
      if (decoded is Map<String, dynamic>) {
        payload = decoded;
      }
    } catch (_) {
      payload = null;
    }
    if (payload == null) return null;

    return OfflineSyncEvent(
      eventId: eventId,
      eventType: eventType,
      payload: payload,
      queuedAt: DateTime.fromMillisecondsSinceEpoch(queuedAtRaw),
      isSynced: row['is_synced'] is int && (row['is_synced'] as int) == 1,
      syncedAt: row['synced_at'] is int
          ? DateTime.fromMillisecondsSinceEpoch(row['synced_at'] as int)
          : null,
    );
  }

  Future<List<OfflineSyncEvent>> _loadAllEvents() async {
    final db = _db;
    if (db == null) return [];

    final rows = await db.query('sync_events', orderBy: 'queued_at ASC');
    final events = <OfflineSyncEvent>[];
    for (final row in rows) {
      final event = _parseRow(row);
      if (event != null) {
        events.add(event);
        continue;
      }
      final eventId = row['event_id'];
      if (eventId is String) {
        await db.update(
          'sync_events',
          {'state': stateDeadLetter},
          where: 'event_id = ?',
          whereArgs: [eventId],
        );
      }
    }
    return events;
  }

  Future<void> _emitDbSnapshot() async {
    try {
      final events = await _loadAllEvents();
      _dbController.add(events);
    } catch (err, st) {
      // Never leak a snapshot failure into the caller's async context.
      debugPrint('OfflineFirstSyncService: snapshot emit failed: $err\n$st');
    }
  }

  Future<_SyncOutcome> _syncSingleEvent(OfflineSyncEvent event) async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return _SyncOutcome.retriable;

      _SyncOutcome outcome = await _postEvent(event, user, false);
      if (outcome == _SyncOutcome.unauthorized) {
        // 401: the session token merely expired. Force-refresh it (as the
        // customer SyncEngine does) and retry the request exactly once.
        outcome = await _postEvent(event, user, true);
        if (outcome == _SyncOutcome.unauthorized) {
          outcome = _SyncOutcome.retriable;
        }
      }
      return outcome;
    } catch (e) {
      debugPrint('[OfflineFirstSyncService] Sync failed for event '
          '${event.eventId} (${event.eventType}): $e');
      return _SyncOutcome.retriable;
    }
  }

  Future<_SyncOutcome> _postEvent(
    OfflineSyncEvent event,
    User user,
    bool forceRefresh,
  ) async {
    final token = await user.getIdToken(forceRefresh);

    final tripId = event.payload['trip_id'];

    final requestBody = {
      'idempotencyKey': event.eventId,
      'events': [
        {
          'id': event.eventId,
          'type': event.eventType,
          'trip_id': tripId,
          'payload': event.payload,
          'occurred_at': event.queuedAt.toUtc().toIso8601String(),
        },
      ],
    };

    // POST /api/v1/trips/events/batch — the same endpoint SyncEngine.attemptSync
    // uses. Carries idempotencyKey=event.eventId, so the server returns 409
    // (already present) for a replay; that must count as delivered.
    final response = await http.post(
      Uri.parse('$_apiBaseUrl/api/v1/trips/events/batch'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode(requestBody),
    );

    final code = response.statusCode;
    if (code == 200 || code == 202 || code == 208 || code == 409) {
      return _SyncOutcome.success;
    }
    if (code == 401) {
      return _SyncOutcome.unauthorized;
    }
    if (code == 429 || (code >= 500 && code <= 599)) {
      return _SyncOutcome.retriable;
    }
    // Any other 4xx (validation/404/etc.) is non-retryable.
    return _SyncOutcome.permanent;
  }

  /// Runs at most one sync pass at a time, coalescing triggers that arrive
  /// while a pass is already in flight. A pass that finished while new events
  /// were being queued triggers a follow-up pass so nothing is left behind.
  Future<void> _processSyncQueue() async {
    if (_isSyncing) {
      _syncQueued = true;
      return;
    }
    _isSyncing = true;
    try {
      do {
        _syncQueued = false;
        try {
          await _runSyncPass();
        } catch (err, st) {
          // A storage failure in one pass must not escape as an unhandled
          // async error; the guard resets so the next trigger retries.
          debugPrint('OfflineFirstSyncService: sync pass failed: $err\n$st');
        }
      } while (_syncQueued);
    } finally {
      _isSyncing = false;
    }
  }

  Future<void> _runSyncPass() async {
    final db = _db;
    if (db == null) return;

    final unsynced = await db.query(
      'sync_events',
      where: 'is_synced = 0 AND state = ?',
      whereArgs: [statePending],
      orderBy: 'queued_at ASC',
    );

    if (unsynced.isEmpty) return;

    final batchSize = 10;
    for (int i = 0; i < unsynced.length; i += batchSize) {
      final batch = unsynced.skip(i).take(batchSize).toList();

      // Parse the batch up-front: a corrupt pending row is dead-lettered here
      // instead of throwing out of Future.wait and aborting the whole pass.
      final parsed = <({String eventId, OfflineSyncEvent event, int retryCount})>[];
      for (final row in batch) {
        final eventId = row['event_id'];
        if (eventId is! String) continue;
        final event = _parseRow(row);
        if (event == null) {
          await db.update(
            'sync_events',
            {'state': stateDeadLetter},
            where: 'event_id = ?',
            whereArgs: [eventId],
          );
          continue;
        }
        parsed.add((
          eventId: eventId,
          event: event,
          retryCount: row['retry_count'] is int ? row['retry_count'] as int : 0,
        ));
      }

      final results = await Future.wait(parsed.map((e) => _syncSingleEvent(e.event)));

      for (int j = 0; j < parsed.length; j++) {
        final entry = parsed[j];
        final outcome = results[j];
        if (outcome == _SyncOutcome.success) {
          // Successfully synced (incl. idempotent 409/208 replay): remove the
          // row so the local store does not grow without bound.
          await db.delete('sync_events', where: 'event_id = ?', whereArgs: [entry.eventId]);
        } else if (outcome == _SyncOutcome.permanent) {
          // Non-retryable 4xx: dead-letter immediately rather than burning
          // retries on a request the server will never accept.
          await db.update(
            'sync_events',
            {'state': stateDeadLetter},
            where: 'event_id = ?',
            whereArgs: [entry.eventId],
          );
        } else {
          // Retriable (401/429/5xx/network): keep retrying, dead-letter only
          // once the retry ceiling is reached.
          if (entry.retryCount + 1 >= maxRetries) {
            await db.update(
              'sync_events',
              {'state': stateDeadLetter},
              where: 'event_id = ?',
              whereArgs: [entry.eventId],
            );
          } else {
            await db.update(
              'sync_events',
              {'retry_count': entry.retryCount + 1},
              where: 'event_id = ?',
              whereArgs: [entry.eventId],
            );
          }
        }
      }
    }

    _emitDbSnapshot();
  }

  Future<void> close() async {
    await _db?.close();
    await _connectionController.close();
    await _dbController.close();
  }
}
