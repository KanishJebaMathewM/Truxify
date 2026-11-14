import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import 'connectivity_service.dart';

/// Represents a queued offline operation.
class QueuedOperation {
  final String id;
  final String type; // 'gpsUpdate', 'otpSubmission', 'bookingRequest', etc.
  final String? entityId;
  final String endpoint;
  final String method;
  final Map<String, String> headers;
  final Map<String, dynamic> payload;
  final DateTime createdAt;
  final int retryCount;
  final String status; // 'pending', 'syncing', 'completed', 'conflict', 'failed'
  final String? error;

  QueuedOperation({
    required this.id,
    required this.type,
    this.entityId,
    required this.endpoint,
    this.method = 'POST',
    Map<String, String>? headers,
    required this.payload,
    required this.createdAt,
    this.retryCount = 0,
    this.status = 'pending',
    this.error,
  }) : headers = headers ?? {};

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'type': type,
      'entity_id': entityId,
      'endpoint': endpoint,
      'method': method,
      'headers': jsonEncode(headers),
      'payload': jsonEncode(payload),
      'created_at': createdAt.toIso8601String(),
      'retry_count': retryCount,
      'status': status,
      'error': error,
    };
  }

  factory QueuedOperation.fromMap(Map<String, dynamic> map) {
    Map<String, String> parsedHeaders = {};
    if (map['headers'] != null) {
      try {
        final decoded = jsonDecode(map['headers'] as String);
        if (decoded is Map) {
          parsedHeaders = decoded.map((k, v) => MapEntry(k.toString(), v.toString()));
        }
      } catch (_) {}
    }

    Map<String, dynamic> parsedPayload = {};
    if (map['payload'] != null) {
      try {
        final decoded = jsonDecode(map['payload'] as String);
        if (decoded is Map<String, dynamic>) {
          parsedPayload = decoded;
        }
      } catch (_) {}
    }

    return QueuedOperation(
      id: map['id'] as String,
      type: map['type'] as String,
      entityId: map['entity_id'] as String?,
      endpoint: map['endpoint'] as String,
      method: (map['method'] as String?) ?? 'POST',
      headers: parsedHeaders,
      payload: parsedPayload,
      createdAt: DateTime.tryParse(map['created_at'] as String? ?? '') ?? DateTime.now(),
      retryCount: (map['retry_count'] as int?) ?? 0,
      status: (map['status'] as String?) ?? 'pending',
      error: map['error'] as String?,
    );
  }
}

/// Result summary of an offline queue flush execution.
class FlushSummary {
  final int totalProcessed;
  final int succeeded;
  final int conflictsResolved;
  final int failed;
  final bool stoppedByNetwork;

  const FlushSummary({
    required this.totalProcessed,
    required this.succeeded,
    required this.conflictsResolved,
    required this.failed,
    required this.stoppedByNetwork,
  });

  @override
  String toString() =>
      'FlushSummary(processed: $totalProcessed, success: $succeeded, conflicts: $conflictsResolved, failed: $failed, stoppedByNetwork: $stoppedByNetwork)';
}

/// Offline operational queue for all Truxify Flutter apps.
///
/// Automatically intercepts network actions when offline, buffers them in sqflite,
/// and sequentially replays them upon reconnection while handling server conflicts.
class OfflineQueue {
  static const String _defaultDbName = 'truxify_offline_queue.db';
  static const String _tableName = 'offline_queue';

  static OfflineQueue? _instance;

  static OfflineQueue get instance {
    _instance ??= OfflineQueue._internal();
    return _instance!;
  }

  final String _dbName;
  Database? _db;
  final ConnectivityService _connectivity;
  final http.Client _httpClient;
  bool _isFlushing = false;
  String _apiBaseUrl = '';

  OfflineQueue._internal({
    String dbName = _defaultDbName,
    ConnectivityService? connectivity,
    http.Client? httpClient,
  })  : _dbName = dbName,
        _connectivity = connectivity ?? ConnectivityService.instance,
        _httpClient = httpClient ?? http.Client() {
    _initAutoFlush();
  }

  @visibleForTesting
  OfflineQueue.forTesting({
    String dbName = 'test_offline_queue.db',
    Database? database,
    ConnectivityService? connectivity,
    http.Client? httpClient,
    String apiBaseUrl = 'https://api.truxify.com',
  })  : _dbName = dbName,
        _db = database,
        _connectivity = connectivity ?? ConnectivityService.forTesting(),
        _httpClient = httpClient ?? http.Client(),
        _apiBaseUrl = apiBaseUrl;

  /// Sets the backend API base URL (e.g. https://api.truxify.com).
  void setApiBaseUrl(String baseUrl) {
    _apiBaseUrl = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
  }

  void _initAutoFlush() {
    _connectivity.addReconnectListener(() async {
      debugPrint('[OfflineQueue] Reconnect event detected, initiating queue flush...');
      await flushQueue();
    });
  }

  Future<Database> get database async {
    if (_db != null) return _db!;
    _db = await _initDatabase();
    return _db!;
  }

  Future<Database> _initDatabase() async {
    final databasesPath = await getDatabasesPath();
    final path = p.join(databasesPath, _dbName);

    return await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE $_tableName (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            entity_id TEXT,
            endpoint TEXT NOT NULL,
            method TEXT NOT NULL,
            headers TEXT,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            retry_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            error TEXT
          )
        ''');
        await db.execute('CREATE INDEX idx_offline_queue_status ON $_tableName (status, created_at)');
      },
    );
  }

  /// Queues a general operation into local SQLite storage.
  Future<String> queueOperation({
    required String type,
    required String endpoint,
    String method = 'POST',
    Map<String, dynamic>? payload,
    Map<String, String>? headers,
    String? entityId,
  }) async {
    final db = await database;
    final id = const Uuid().v4();
    final operation = QueuedOperation(
      id: id,
      type: type,
      entityId: entityId,
      endpoint: endpoint,
      method: method,
      headers: headers,
      payload: payload ?? {},
      createdAt: DateTime.now().toUtc(),
      status: 'pending',
    );

    await db.insert(
      _tableName,
      operation.toMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );

    debugPrint('[OfflineQueue] Queued $type operation $id (entity: $entityId)');

    // If online right now, attempt immediate flush
    if (_connectivity.isOnline) {
      unawaited(flushQueue());
    }

    return id;
  }

  /// Queues an offline GPS update ping.
  Future<String> queueGpsUpdate({
    required double latitude,
    required double longitude,
    double? speed,
    double? heading,
    double? accuracy,
    String? tripId,
    String? driverId,
    Map<String, dynamic>? extra,
  }) async {
    return queueOperation(
      type: 'gpsUpdate',
      entityId: tripId,
      endpoint: '/api/tracking/batch',
      method: 'POST',
      payload: {
        'coordinates': [
          {
            'latitude': latitude,
            'longitude': longitude,
            'speed': speed,
            'heading': heading,
            'accuracy': accuracy,
            'timestamp': DateTime.now().toUtc().toIso8601String(),
          }
        ],
        'trip_id': tripId,
        'driver_id': driverId,
        'replayed': true,
        ...?extra,
      },
    );
  }

  /// Queues an offline OTP delivery confirmation submission.
  Future<String> queueOtpSubmission({
    required String stopId,
    required String tripId,
    required String otp,
    Map<String, dynamic>? extra,
  }) async {
    return queueOperation(
      type: 'otpSubmission',
      entityId: tripId,
      endpoint: '/api/v1/trips/events/batch',
      method: 'POST',
      payload: {
        'events': [
          {
            'id': const Uuid().v4(),
            'type': 'verifyDeliveryOtp',
            'trip_id': tripId,
            'payload': {
              'stop_id': stopId,
              'otp': otp,
              'verified_offline': true,
              'submitted_at': DateTime.now().toUtc().toIso8601String(),
              ...?extra,
            },
            'occurred_at': DateTime.now().toUtc().toIso8601String(),
          }
        ],
        'idempotencyKey': 'otp-$tripId-$stopId',
      },
    );
  }

  /// Queues an offline booking request or bid submission.
  Future<String> queueBookingRequest({
    required String loadId,
    required num amount,
    required Map<String, dynamic> bookingDetails,
    String? customerId,
  }) async {
    return queueOperation(
      type: 'bookingRequest',
      entityId: loadId,
      endpoint: '/api/loads/$loadId/bids',
      method: 'POST',
      payload: {
        'load_id': loadId,
        'amount': amount,
        'booking_details': bookingDetails,
        'customer_id': customerId,
        'queued_at': DateTime.now().toUtc().toIso8601String(),
      },
    );
  }

  /// Retrieves all operations currently waiting in the pending queue.
  Future<List<QueuedOperation>> getPendingOperations() async {
    final db = await database;
    final rows = await db.query(
      _tableName,
      where: 'status IN (?, ?)',
      whereArgs: ['pending', 'failed'],
      orderBy: 'created_at ASC',
    );
    return rows.map((r) => QueuedOperation.fromMap(r)).toList();
  }

  /// Flushes all pending operations sequentially in chronological order.
  ///
  /// Resolves conflicts when server indicates an entity state divergence
  /// (e.g. 409 Conflict, or booking already cancelled server-side).
  Future<FlushSummary> flushQueue({
    Future<http.Response> Function(QueuedOperation operation)? customDispatcher,
    void Function(QueuedOperation operation, String conflictReason)? onConflict,
    String? authToken,
  }) async {
    if (_isFlushing) {
      debugPrint('[OfflineQueue] Flush already in progress, skipping duplicate call.');
      return const FlushSummary(
        totalProcessed: 0,
        succeeded: 0,
        conflictsResolved: 0,
        failed: 0,
        stoppedByNetwork: false,
      );
    }

    _isFlushing = true;
    int processed = 0;
    int succeeded = 0;
    int conflictsResolved = 0;
    int failed = 0;
    bool stoppedByNetwork = false;

    try {
      final operations = await getPendingOperations();
      if (operations.isEmpty) {
        return const FlushSummary(
          totalProcessed: 0,
          succeeded: 0,
          conflictsResolved: 0,
          failed: 0,
          stoppedByNetwork: false,
        );
      }

      debugPrint('[OfflineQueue] Flushing ${operations.length} queued operations in chronological order...');
      final db = await database;

      for (final op in operations) {
        // Double-check connectivity
        if (!_connectivity.isOnline) {
          stoppedByNetwork = true;
          debugPrint('[OfflineQueue] Network disconnected during flush, pausing execution.');
          break;
        }

        processed++;
        await db.update(
          _tableName,
          {'status': 'syncing'},
          where: 'id = ?',
          whereArgs: [op.id],
        );

        try {
          http.Response response;
          if (customDispatcher != null) {
            response = await customDispatcher(op);
          } else {
            final uri = Uri.parse(
              op.endpoint.startsWith('http') ? op.endpoint : '$_apiBaseUrl${op.endpoint}',
            );

            final headers = <String, String>{
              'Content-Type': 'application/json',
              if (authToken != null) 'Authorization': 'Bearer $authToken',
              ...op.headers,
            };

            switch (op.method.toUpperCase()) {
              case 'GET':
                response = await _httpClient.get(uri, headers: headers);
                break;
              case 'PUT':
                response = await _httpClient.put(uri, headers: headers, body: jsonEncode(op.payload));
                break;
              case 'PATCH':
                response = await _httpClient.patch(uri, headers: headers, body: jsonEncode(op.payload));
                break;
              case 'DELETE':
                response = await _httpClient.delete(uri, headers: headers, body: jsonEncode(op.payload));
                break;
              case 'POST':
              default:
                response = await _httpClient.post(uri, headers: headers, body: jsonEncode(op.payload));
                break;
            }
          }

          final statusCode = response.statusCode;

          // 1. Successful execution
          if (statusCode >= 200 && statusCode < 300) {
            await db.delete(_tableName, where: 'id = ?', whereArgs: [op.id]);
            succeeded++;
            debugPrint('[OfflineQueue] Successfully synced operation ${op.id} (${op.type})');
          }
          // 2. Conflict Handling (e.g. 409 Conflict, or 400/404 indicating booking already cancelled)
          else if (statusCode == 409 || _isServerConflict(statusCode, response.body)) {
            conflictsResolved++;
            final conflictReason = _extractConflictReason(response.body);
            debugPrint('[OfflineQueue] Conflict detected for ${op.id} (${op.type}): $conflictReason');

            await db.update(
              _tableName,
              {
                'status': 'conflict',
                'error': conflictReason,
              },
              where: 'id = ?',
              whereArgs: [op.id],
            );

            if (onConflict != null) {
              onConflict(op, conflictReason);
            }
          }
          // 3. Client permanent error (400, 422) that cannot be resolved by retrying
          else if (statusCode == 400 || statusCode == 422 || statusCode == 404) {
            failed++;
            await db.update(
              _tableName,
              {
                'status': 'failed',
                'retry_count': op.retryCount + 1,
                'error': 'Client error $statusCode: ${response.body}',
              },
              where: 'id = ?',
              whereArgs: [op.id],
            );
          }
          // 4. Server transient error (500, 502, 503) or rate limit (429)
          else {
            failed++;
            await db.update(
              _tableName,
              {
                'status': 'pending',
                'retry_count': op.retryCount + 1,
                'error': 'Server error $statusCode: ${response.body}',
              },
              where: 'id = ?',
              whereArgs: [op.id],
            );
            // Break loop on server issues to avoid thrashing
            break;
          }
        } catch (e) {
          failed++;
          debugPrint('[OfflineQueue] Exception processing operation ${op.id}: $e');
          await db.update(
            _tableName,
            {
              'status': 'pending',
              'retry_count': op.retryCount + 1,
              'error': e.toString(),
            },
            where: 'id = ?',
            whereArgs: [op.id],
          );

          if (e is SocketException || e is TimeoutException) {
            stoppedByNetwork = true;
            break;
          }
        }
      }
    } finally {
      _isFlushing = false;
    }

    return FlushSummary(
      totalProcessed: processed,
      succeeded: succeeded,
      conflictsResolved: conflictsResolved,
      failed: failed,
      stoppedByNetwork: stoppedByNetwork,
    );
  }

  bool _isServerConflict(int statusCode, String body) {
    if (statusCode == 409) return true;
    final lower = body.toLowerCase();
    return lower.contains('already cancelled') ||
        lower.contains('already accepted') ||
        lower.contains('already verified') ||
        lower.contains('booking_cancelled') ||
        lower.contains('conflict') ||
        lower.contains('no longer available');
  }

  String _extractConflictReason(String body) {
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map && decoded['error'] != null) {
        return decoded['error'].toString();
      }
      if (decoded is Map && decoded['message'] != null) {
        return decoded['message'].toString();
      }
    } catch (_) {}
    return body.isNotEmpty ? body : 'Conflict detected with server state';
  }

  /// Clears completed or conflict records from database.
  Future<int> clearResolvedOperations() async {
    final db = await database;
    return await db.delete(
      _tableName,
      where: 'status IN (?, ?)',
      whereArgs: ['completed', 'conflict'],
    );
  }

  /// Clears all items in the queue (e.g. upon user logout).
  Future<void> clearAll() async {
    final db = await database;
    await db.delete(_tableName);
  }

  void dispose() {
    _httpClient.close();
  }
}
