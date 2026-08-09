import 'dart:convert';
import 'dart:io';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:uuid/uuid.dart';
import 'package:flutter/foundation.dart';

class SyncEngine {
  static const String _dbName = 'truxify_offline_sync.db';
  static Database? _db;
  static bool _isSyncing = false;

  /// Backend base URL, injected at build time via --dart-define.
  /// Mirrors ApiClient so this service never bakes in a hardcoded
  /// cleartext host (previously `http://10.0.2.2:5000`).
  static String get apiBaseUrl {
    const envUrl = String.fromEnvironment('TRUXIFY_API_BASE_URL');
    if (envUrl.isNotEmpty) return envUrl;
    if (kReleaseMode) throw StateError('TRUXIFY_API_BASE_URL must be set in release mode');

    if (kIsWeb) return 'http://localhost:5000';
    if (Platform.isAndroid) return 'http://10.0.2.2:5000';
    return 'http://localhost:5000';
  }

  static Future<Database> get database async {
    if (_db != null) return _db!;
    _db = await _initDb();
    return _db!;
  }

  static Future<Database> _initDb() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, _dbName);

    return await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE sync_queue (
            id TEXT PRIMARY KEY,
            trip_id TEXT,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            occurred_at TEXT NOT NULL
          )
        ''');
      },
    );
  }

  /// Queues an event locally. If the network is available, immediately attempts sync.
  static Future<void> queueEvent({
    required String tripId,
    required String eventType,
    required Map<String, dynamic> payload,
  }) async {
    final db = await database;
    final eventId = const Uuid().v4();
    final occurredAt = DateTime.now().toIso8601String();

    await db.insert('sync_queue', {
      'id': eventId,
      'trip_id': tripId,
      'event_type': eventType,
      'payload': jsonEncode(payload),
      'occurred_at': occurredAt,
    });

    debugPrint('[SyncEngine] Queued $eventType for trip $tripId.');
    
    final connectivityResults = await Connectivity().checkConnectivity();
    if (!connectivityResults.contains(ConnectivityResult.none)) {
      await attemptSync();
    }
  }

  /// Flushes the queue to the backend.
  static Future<void> attemptSync() async {
    if (_isSyncing) return;
    final connectivityResults = await Connectivity().checkConnectivity();
    if (connectivityResults.contains(ConnectivityResult.none)) return;

    final db = await database;
    final events = await db.query('sync_queue', orderBy: 'occurred_at ASC');
    if (events.isEmpty) return;

    _isSyncing = true;
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return;
      final token = await user.getIdToken();

      final idempotencyKey = const Uuid().v4();

      final requestBody = {
        'idempotencyKey': idempotencyKey,
        'events': events.map((e) => {
          'id': e['id'],
          'type': e['event_type'],
          'trip_id': e['trip_id'],
          'payload': jsonDecode(e['payload'] as String),
          'occurred_at': e['occurred_at'],
        }).toList(),
      };

      // The backend batch sync endpoint is POST /api/v1/trips/events/batch
      // (see tripRoutes.js). The base URL is injected via --dart-define.
      final response = await http.post(
        Uri.parse('${apiBaseUrl}/api/v1/trips/events/batch'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(requestBody),
      );

      if (response.statusCode == 202) {
        // Successfully synced, clear the queue
        final eventIds = events.map((e) => e['id']).toList();
        await db.delete(
          'sync_queue',
          where: 'id IN (${List.filled(eventIds.length, '?').join(',')})',
          whereArgs: eventIds,
        );
        debugPrint('[SyncEngine] Successfully synced ${events.length} events.');
      } else {
        debugPrint('[SyncEngine] Sync failed with status ${response.statusCode}');
      }
    } catch (e) {
      debugPrint('[SyncEngine] Sync exception: $e');
    } finally {
      _isSyncing = false;
    }
  }
}
