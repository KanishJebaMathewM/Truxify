import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import 'package:truxify_shared/truxify_shared.dart' as shared;

/// Model for a buffered GPS coordinate snapshot collected during offline periods.
class BufferedGpsCoordinate {
  final int? id;
  final String? tripId;
  final String? driverId;
  final double latitude;
  final double longitude;
  final double? speed;
  final double? heading;
  final double? accuracy;
  final DateTime timestamp;

  BufferedGpsCoordinate({
    this.id,
    this.tripId,
    this.driverId,
    required this.latitude,
    required this.longitude,
    this.speed,
    this.heading,
    this.accuracy,
    required this.timestamp,
  });

  Map<String, dynamic> toMap() {
    return {
      if (id != null) 'id': id,
      'trip_id': tripId,
      'driver_id': driverId,
      'latitude': latitude,
      'longitude': longitude,
      'speed': speed,
      'heading': heading,
      'accuracy': accuracy,
      'timestamp': timestamp.toIso8601String(),
      'is_uploaded': 0,
    };
  }

  Map<String, dynamic> toApiPayload() {
    return {
      'latitude': latitude,
      'longitude': longitude,
      if (speed != null) 'speed': speed,
      if (heading != null) 'heading': heading,
      if (accuracy != null) 'accuracy': accuracy,
      'timestamp': timestamp.toIso8601String(),
    };
  }

  factory BufferedGpsCoordinate.fromMap(Map<String, dynamic> map) {
    return BufferedGpsCoordinate(
      id: map['id'] as int?,
      tripId: map['trip_id'] as String?,
      driverId: map['driver_id'] as String?,
      latitude: (map['latitude'] as num).toDouble(),
      longitude: (map['longitude'] as num).toDouble(),
      speed: (map['speed'] as num?)?.toDouble(),
      heading: (map['heading'] as num?)?.toDouble(),
      accuracy: (map['accuracy'] as num?)?.toDouble(),
      timestamp: DateTime.tryParse(map['timestamp'] as String? ?? '') ?? DateTime.now(),
    );
  }
}

/// Result of uploading a batch of buffered GPS coordinates.
class GpsBatchUploadResult {
  final int totalUploaded;
  final int batchesCount;
  final bool success;
  final String? error;

  const GpsBatchUploadResult({
    required this.totalUploaded,
    required this.batchesCount,
    required this.success,
    this.error,
  });

  @override
  String toString() =>
      'GpsBatchUploadResult(uploaded: $totalUploaded, batches: $batchesCount, success: $success, error: $error)';
}

/// Service that buffers high-frequency GPS coordinates in local SQLite when offline
/// and batch-uploads them to `POST /api/tracking/batch` upon reconnection.
class GpsBufferService {
  static const String _defaultDbName = 'truxify_gps_buffer.db';
  static const String _tableName = 'gps_buffer';
  static const int defaultBatchSize = 100;
  static const Duration bufferInterval = Duration(seconds: 5);

  static GpsBufferService? _instance;

  static GpsBufferService get instance {
    _instance ??= GpsBufferService._internal();
    return _instance!;
  }

  final String _dbName;
  Database? _db;
  Timer? _periodicTimer;
  bool _isUploading = false;
  String _apiBaseUrl = '';
  final http.Client _httpClient;

  String? _activeTripId;
  String? _activeDriverId;
  Future<Map<String, dynamic>?> Function()? _locationProvider;
  bool Function()? _offlineCheck;

  GpsBufferService._internal({
    String dbName = _defaultDbName,
    http.Client? httpClient,
  })  : _dbName = dbName,
        _httpClient = httpClient ?? http.Client();

  @visibleForTesting
  GpsBufferService.forTesting({
    String dbName = 'test_gps_buffer.db',
    Database? database,
    http.Client? httpClient,
    String apiBaseUrl = 'https://api.truxify.com',
  })  : _dbName = dbName,
        _db = database,
        _httpClient = httpClient ?? http.Client(),
        _apiBaseUrl = apiBaseUrl;

  void setApiBaseUrl(String url) {
    _apiBaseUrl = url.endsWith('/') ? url.substring(0, url.length - 1) : url;
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id TEXT,
            driver_id TEXT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            speed REAL,
            heading REAL,
            accuracy REAL,
            timestamp TEXT NOT NULL,
            is_uploaded INTEGER DEFAULT 0
          )
        ''');
        await db.execute('CREATE INDEX idx_gps_buffer_uploaded ON $_tableName (is_uploaded, timestamp)');
      },
    );
  }

  /// Starts the 5-second periodic buffering timer.
  ///
  /// Obtains coordinates from [locationProvider] every 5 seconds when offline
  /// and persists them to SQLite.
  void startBuffering({
    String? tripId,
    String? driverId,
    Future<Map<String, dynamic>?> Function()? locationProvider,
    bool Function()? offlineCheck,
  }) {
    _activeTripId = tripId;
    _activeDriverId = driverId;
    _locationProvider = locationProvider;
    _offlineCheck = offlineCheck;

    _periodicTimer?.cancel();
    _periodicTimer = Timer.periodic(bufferInterval, (_) async {
      final isOffline = _offlineCheck != null ? _offlineCheck!() : true;
      if (!isOffline) return;

      if (_locationProvider != null) {
        try {
          final loc = await _locationProvider!();
          if (loc != null && loc['latitude'] != null && loc['longitude'] != null) {
            await bufferCoordinate(
              latitude: (loc['latitude'] as num).toDouble(),
              longitude: (loc['longitude'] as num).toDouble(),
              speed: (loc['speed'] as num?)?.toDouble(),
              heading: (loc['heading'] as num?)?.toDouble(),
              accuracy: (loc['accuracy'] as num?)?.toDouble(),
              tripId: _activeTripId,
              driverId: _activeDriverId,
            );
          }
        } catch (e) {
          debugPrint('[GpsBuffer] Error sampling location for buffer: $e');
        }
      }
    });

    debugPrint('[GpsBuffer] 5-second periodic offline GPS buffering started for trip: $_activeTripId');
  }

  /// Stops periodic buffering timer.
  void stopBuffering() {
    _periodicTimer?.cancel();
    _periodicTimer = null;
    debugPrint('[GpsBuffer] Periodic GPS buffering stopped.');
  }

  /// Directly buffers a single GPS coordinate snapshot into SQLite.
  Future<int> bufferCoordinate({
    required double latitude,
    required double longitude,
    double? speed,
    double? heading,
    double? accuracy,
    String? tripId,
    String? driverId,
    DateTime? timestamp,
  }) async {
    final db = await database;
    final coord = BufferedGpsCoordinate(
      tripId: tripId ?? _activeTripId,
      driverId: driverId ?? _activeDriverId,
      latitude: latitude,
      longitude: longitude,
      speed: speed,
      heading: heading,
      accuracy: accuracy,
      timestamp: (timestamp ?? DateTime.now()).toUtc(),
    );

    final id = await db.insert(_tableName, coord.toMap());
    debugPrint('[GpsBuffer] Buffered GPS point #$id ($latitude, $longitude) at ${coord.timestamp}');
    return id;
  }

  /// Retrieves un-uploaded buffered coordinates ordered chronologically.
  Future<List<BufferedGpsCoordinate>> getPendingCoordinates({int limit = defaultBatchSize}) async {
    final db = await database;
    final rows = await db.query(
      _tableName,
      where: 'is_uploaded = 0',
      orderBy: 'timestamp ASC',
      limit: limit,
    );
    return rows.map((r) => BufferedGpsCoordinate.fromMap(r)).toList();
  }

  /// Count of coordinates waiting in the buffer.
  Future<int> getPendingCount() async {
    final db = await database;
    final result = await db.rawQuery('SELECT COUNT(*) as count FROM $_tableName WHERE is_uploaded = 0');
    return Sqflite.firstIntValue(result) ?? 0;
  }

  /// Batch-uploads all buffered coordinates to POST /api/tracking/batch.
  ///
  /// Executed on reconnect to allow the backend to replay the GPS trail and fill
  /// tracking gaps. Deletes successfully uploaded records upon receipt of 200/202.
  Future<GpsBatchUploadResult> uploadBufferedCoordinates({
    String? baseUrl,
    String? authToken,
    http.Client? client,
    int batchSize = defaultBatchSize,
  }) async {
    if (_isUploading) {
      debugPrint('[GpsBuffer] Upload already in progress, skipping duplicate invocation.');
      return const GpsBatchUploadResult(
        totalUploaded: 0,
        batchesCount: 0,
        success: true,
      );
    }

    _isUploading = true;
    final activeClient = client ?? _httpClient;
    final targetUrl = baseUrl ?? _apiBaseUrl;
    final uri = Uri.parse('$targetUrl/api/tracking/batch');
    int totalUploaded = 0;
    int batchesCount = 0;

    try {
      while (true) {
        final pending = await getPendingCoordinates(limit: batchSize);
        if (pending.isEmpty) break;

        batchesCount++;
        final batchId = const Uuid().v4();
        final tripId = pending.first.tripId;
        final driverId = pending.first.driverId;

        final requestPayload = {
          'batch_id': batchId,
          if (tripId != null) 'trip_id': tripId,
          if (driverId != null) 'driver_id': driverId,
          'coordinates': pending.map((c) => c.toApiPayload()).toList(),
          'replayed': true,
        };

        debugPrint('[GpsBuffer] Uploading batch $batchId with ${pending.length} coordinates to $uri...');

        final response = await activeClient.post(
          uri,
          headers: {
            'Content-Type': 'application/json',
            if (authToken != null) 'Authorization': 'Bearer $authToken',
          },
          body: jsonEncode(requestPayload),
        );

        if (response.statusCode == 200 || response.statusCode == 201 || response.statusCode == 202) {
          final ids = pending.map((c) => c.id!).toList();
          final db = await database;
          await db.delete(
            _tableName,
            where: 'id IN (${List.filled(ids.length, '?').join(',')})',
            whereArgs: ids,
          );
          totalUploaded += pending.length;
          debugPrint('[GpsBuffer] Batch $batchId successfully acknowledged. Deleted ${ids.length} points from local buffer.');
        } else {
          final errMsg = 'Server rejected batch with status ${response.statusCode}: ${response.body}';
          debugPrint('[GpsBuffer] $errMsg');
          return GpsBatchUploadResult(
            totalUploaded: totalUploaded,
            batchesCount: batchesCount,
            success: false,
            error: errMsg,
          );
        }
      }

      return GpsBatchUploadResult(
        totalUploaded: totalUploaded,
        batchesCount: batchesCount,
        success: true,
      );
    } catch (e) {
      debugPrint('[GpsBuffer] Error uploading buffered coordinates: $e');
      return GpsBatchUploadResult(
        totalUploaded: totalUploaded,
        batchesCount: batchesCount,
        success: false,
        error: e.toString(),
      );
    } finally {
      _isUploading = false;
    }
  }

  /// Clears all buffered coordinates.
  Future<void> clearBuffer() async {
    final db = await database;
    await db.delete(_tableName);
  }

  void dispose() {
    stopBuffering();
    _httpClient.close();
  }
}
