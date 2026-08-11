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
    _initDatabase();
  }

  Future<void> _initDatabase() async {
    final dir = await getApplicationDocumentsDirectory();
    final dbPath = p.join(dir.path, 'offline_sync.db');
    _db = await openDatabase(
      dbPath,
      version: 2,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE sync_events (
            event_id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            queued_at INTEGER NOT NULL,
            is_synced INTEGER NOT NULL DEFAULT 0,
            synced_at INTEGER,
            retry_count INTEGER NOT NULL DEFAULT 0
          )
        ''');
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          await db.execute(
            'ALTER TABLE sync_events ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0',
          );
        }
      },
    );
    _emitDbSnapshot();
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

  Future<List<OfflineSyncEvent>> _loadAllEvents() async {
    final db = _db;
    if (db == null) return [];

    final rows = await db.query('sync_events', orderBy: 'queued_at ASC');
    return rows.map((row) => OfflineSyncEvent(
      eventId: row['event_id'] as String,
      eventType: row['event_type'] as String,
      payload: jsonDecode(row['payload'] as String) as Map<String, dynamic>,
      queuedAt: DateTime.fromMillisecondsSinceEpoch(row['queued_at'] as int),
      isSynced: (row['is_synced'] as int) == 1,
      syncedAt: row['synced_at'] != null
          ? DateTime.fromMillisecondsSinceEpoch(row['synced_at'] as int)
          : null,
    )).toList();
  }

  Future<void> _emitDbSnapshot() async {
    final events = await _loadAllEvents();
    _dbController.add(events);
  }

  Future<bool> _syncSingleEvent(OfflineSyncEvent event) async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return false;
      final token = await user.getIdToken();

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
      // uses. Only a real 2xx response counts as success so the local queue is
      // never marked synced (and never dropped) without reaching the backend.
      final response = await http.post(
        Uri.parse('$_apiBaseUrl/api/v1/trips/events/batch'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(requestBody),
      );

      return response.statusCode == 200 || response.statusCode == 202;
    } catch (_) {
      return false;
    }
  }

  Future<void> _processSyncQueue() async {
    final db = _db;
    if (db == null) return;

    final unsynced = await db.query(
      'sync_events',
      where: 'is_synced = 0',
      orderBy: 'queued_at ASC',
    );

    if (unsynced.isEmpty) return;

    final batchSize = 10;
    for (int i = 0; i < unsynced.length; i += batchSize) {
      final batch = unsynced.skip(i).take(batchSize).toList();
      final results = await Future.wait(
        batch.map((row) => _syncSingleEvent(OfflineSyncEvent(
          eventId: row['event_id'] as String,
          eventType: row['event_type'] as String,
          payload: jsonDecode(row['payload'] as String) as Map<String, dynamic>,
          queuedAt: DateTime.fromMillisecondsSinceEpoch(row['queued_at'] as int),
        ))),
      );

      for (int j = 0; j < batch.length; j++) {
        if (results[j]) {
          await db.update(
            'sync_events',
            {
              'is_synced': 1,
              'synced_at': DateTime.now().millisecondsSinceEpoch,
            },
            where: 'event_id = ?',
            whereArgs: [batch[j]['event_id']],
          );
        } else {
          final retries = batch[j]['retry_count'] as int? ?? 0;
          if (retries < 3) {
            await db.update(
              'sync_events',
              {'retry_count': retries + 1},
              where: 'event_id = ?',
              whereArgs: [batch[j]['event_id']],
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
