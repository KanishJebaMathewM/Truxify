import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:truxify_shared/truxify_shared.dart';

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
          CREATE TABLE offline_queue (
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
      },
    );
  });

  tearDown(() async {
    await db.close();
  });

  group('OfflineQueue', () {
    test('queues GPS updates, OTP submissions, and booking requests in SQLite', () async {
      final connectivity = ConnectivityService.forTesting(initialOnline: false);
      final queue = OfflineQueue.forTesting(
        database: db,
        connectivity: connectivity,
      );

      final gpsId = await queue.queueGpsUpdate(
        latitude: 19.0760,
        longitude: 72.8777,
        tripId: 'TRIP-101',
      );

      final otpId = await queue.queueOtpSubmission(
        stopId: 'STOP-2',
        tripId: 'TRIP-101',
        otp: '4829',
      );

      final bookingId = await queue.queueBookingRequest(
        loadId: 'LOAD-55',
        amount: 8500,
        bookingDetails: {'truck_type': 'Flatbed 10T'},
      );

      expect(gpsId, isNotEmpty);
      expect(otpId, isNotEmpty);
      expect(bookingId, isNotEmpty);

      final pending = await queue.getPendingOperations();
      expect(pending.length, 3);
      expect(pending[0].type, 'gpsUpdate');
      expect(pending[1].type, 'otpSubmission');
      expect(pending[2].type, 'bookingRequest');
    });

    test('flushes queue in order and handles 409 conflict gracefully', () async {
      final connectivity = ConnectivityService.forTesting(initialOnline: true);

      final mockClient = MockClient((request) async {
        if (request.url.path.contains('/api/tracking/batch')) {
          return http.Response(jsonEncode({'success': true}), 200);
        }
        if (request.url.path.contains('/api/loads/LOAD-55/bids')) {
          // Simulate conflict: load was already cancelled or assigned server-side
          return http.Response(
            jsonEncode({'error': 'Booking was already cancelled server-side'}),
            409,
          );
        }
        return http.Response(jsonEncode({'success': true}), 200);
      });

      final queue = OfflineQueue.forTesting(
        database: db,
        connectivity: connectivity,
        httpClient: mockClient,
      );

      await queue.queueGpsUpdate(latitude: 19.0760, longitude: 72.8777);
      await queue.queueBookingRequest(
        loadId: 'LOAD-55',
        amount: 8500,
        bookingDetails: {},
      );

      String? capturedConflictReason;
      final summary = await queue.flushQueue(
        onConflict: (op, reason) {
          capturedConflictReason = reason;
        },
      );

      expect(summary.totalProcessed, 2);
      expect(summary.succeeded, 1);
      expect(summary.conflictsResolved, 1);
      expect(capturedConflictReason, contains('already cancelled'));

      // Verify no pending items remain (successful deleted, conflict marked)
      final pending = await queue.getPendingOperations();
      expect(pending, isEmpty);
    });
  });

  group('OfflineBanner', () {
    testWidgets('renders persistent offline warning banner when offline', (tester) async {
      final connectivity = ConnectivityService.forTesting(initialOnline: false);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: OfflineBanner(
              connectivityService: connectivity,
              message: "You're offline — changes will sync when reconnected",
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text("You're offline — changes will sync when reconnected"), findsOneWidget);
      expect(find.byIcon(Icons.wifi_off_rounded), findsOneWidget);
    });
  });
}
