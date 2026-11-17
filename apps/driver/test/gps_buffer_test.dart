import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:truxify_driver/services/gps_buffer.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Database db;

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() async {
    db = await openDatabase(
      inMemoryDatabasePath,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE gps_buffer (
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
      },
    );
  });

  tearDown(() async {
    await db.close();
  });

  test('GpsBufferService buffers coordinates in local SQLite DB', () async {
    final service = GpsBufferService.forTesting(database: db);

    final id1 = await service.bufferCoordinate(
      latitude: 19.0760,
      longitude: 72.8777,
      speed: 40.0,
      heading: 90.0,
      accuracy: 5.0,
      tripId: 'TRIP-101',
      driverId: 'DRIVER-1',
    );

    final id2 = await service.bufferCoordinate(
      latitude: 19.0800,
      longitude: 72.8800,
      speed: 42.0,
      heading: 92.0,
      accuracy: 4.0,
      tripId: 'TRIP-101',
      driverId: 'DRIVER-1',
    );

    expect(id1, isPositive);
    expect(id2, isPositive);

    final count = await service.getPendingCount();
    expect(count, 2);

    final pending = await service.getPendingCoordinates();
    expect(pending.length, 2);
    expect(pending.first.latitude, 19.0760);
    expect(pending.last.latitude, 19.0800);
  });

  test('GpsBufferService batch-uploads coordinates to /api/tracking/batch and removes them from buffer', () async {
    http.Request? capturedRequest;

    final mockClient = MockClient((request) async {
      capturedRequest = request as http.Request?;
      if (request.url.path == '/api/tracking/batch') {
        return http.Response(
          jsonEncode({
            'success': true,
            'replayed_count': 2,
            'message': 'Successfully replayed 2 coordinates',
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      return http.Response('Not Found', 404);
    });

    final service = GpsBufferService.forTesting(
      database: db,
      httpClient: mockClient,
      apiBaseUrl: 'https://api.truxify.com',
    );

    await service.bufferCoordinate(
      latitude: 19.0760,
      longitude: 72.8777,
      tripId: 'TRIP-101',
      driverId: 'DRIVER-1',
    );
    await service.bufferCoordinate(
      latitude: 19.0800,
      longitude: 72.8800,
      tripId: 'TRIP-101',
      driverId: 'DRIVER-1',
    );

    final result = await service.uploadBufferedCoordinates(
      baseUrl: 'https://api.truxify.com',
      authToken: 'mock-token',
    );

    expect(result.success, isTrue);
    expect(result.totalUploaded, 2);
    expect(capturedRequest, isNotNull);
    expect(capturedRequest!.url.toString(), 'https://api.truxify.com/api/tracking/batch');
    expect(capturedRequest!.headers['Authorization'], 'Bearer mock-token');

    final body = jsonDecode(capturedRequest!.body);
    expect(body['coordinates'], hasLength(2));
    expect(body['trip_id'], 'TRIP-101');
    expect(body['driver_id'], 'DRIVER-1');

    // Verify buffer is empty after successful upload
    final remainingCount = await service.getPendingCount();
    expect(remainingCount, 0);
  });
}
