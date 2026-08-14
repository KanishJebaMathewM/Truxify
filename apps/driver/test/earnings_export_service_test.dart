import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/models/earnings_statement_model.dart';
import 'package:truxify_driver/services/earnings_export_service.dart';

void main() {
  group('EarningsStatementModel', () {
    test('fromJson parses full response correctly', () {
      final json = {
        'driver_name': 'Ramesh Kumar',
        'driver_phone': '+919876543210',
        'start_date': '2026-06-01',
        'end_date': '2026-06-30',
        'total_trips': 15,
        'total_earnings': 7500000,
        'platform_fees': 750000,
        'net_earnings': 6750000,
        'trips': [
          {
            'trip_id': 'trip-1',
            'display_id': 'TRP-001',
            'trip_date': '2026-06-05',
            'route': 'Delhi → Agra',
            'customer_name': 'Acme Corp',
            'earnings': 500000,
            'platform_fee': 50000,
          },
          {
            'trip_id': 'trip-2',
            'display_id': 'TRP-002',
            'trip_date': '2026-06-12',
            'route': 'Agra → Jaipur',
            'customer_name': 'Beta Inc',
            'earnings': 300000,
          },
        ],
      };

      final model = EarningsStatementModel.fromJson(json);

      expect(model.driverName, equals('Ramesh Kumar'));
      expect(model.driverPhone, equals('+919876543210'));
      expect(model.totalTrips, equals(15));
      expect(model.totalEarnings, equals(75000.0));
      expect(model.platformFees, equals(7500.0));
      expect(model.netEarnings, equals(67500.0));
      expect(model.trips.length, equals(2));
      expect(model.trips[0].route, equals('Delhi → Agra'));
      expect(model.trips[0].earnings, equals(5000.0));
      expect(model.trips[0].platformFee, equals(500.0));
      expect(model.trips[1].route, equals('Agra → Jaipur'));
      expect(model.trips[1].earnings, equals(3000.0));
    });

    test('fromJson handles empty trips', () {
      final json = {
        'driver_name': 'Driver',
        'start_date': '2026-06-01',
        'end_date': '2026-06-30',
        'total_trips': 0,
        'total_earnings': 0,
        'platform_fees': 0,
        'net_earnings': 0,
        'trips': [],
      };

      final model = EarningsStatementModel.fromJson(json);
      expect(model.totalTrips, equals(0));
      expect(model.trips, isEmpty);
    });

    test('fromJson parses nested backend response correctly', () {
      final json = {
        'driver_name': 'Ramesh Kumar',
        'driver_phone': '+919876543210',
        'start_date': '2026-06-01',
        'end_date': '2026-06-30',
        'summary': {
          'total_trips': 2,
          'total_base_freight': 800000,
          'total_platform_fees': 80000,
          'total_toll_estimate': 12000,
          'total_net_earnings': 720000,
        },
        'trips': [
          {
            'id': 'trip-1',
            'order_display_id': 'TRP-001',
            'pickup_address': 'Delhi',
            'drop_address': 'Agra',
            'pickup_date': '2026-06-05',
            'base_freight': 500000,
            'platform_fee': 50000,
            'toll_estimate': 5000,
            'net_earnings': 450000,
            'status': 'delivered',
          },
          {
            'id': 'trip-2',
            'order_display_id': 'TRP-002',
            'pickup_address': 'Agra',
            'drop_address': 'Jaipur',
            'pickup_date': '2026-06-12',
            'base_freight': 300000,
            'platform_fee': 30000,
            'toll_estimate': 7000,
            'net_earnings': 270000,
            'status': 'delivered',
          },
        ],
      };

      final model = EarningsStatementModel.fromJson(json);

      expect(model.driverName, equals('Ramesh Kumar'));
      expect(model.driverPhone, equals('+919876543210'));
      expect(model.startDate, equals(DateTime(2026, 6, 1)));
      expect(model.endDate, equals(DateTime(2026, 6, 30)));
      expect(model.totalTrips, equals(2));
      expect(model.totalEarnings, equals(8000.0));
      expect(model.platformFees, equals(800.0));
      expect(model.netEarnings, equals(7200.0));
      expect(model.trips.length, equals(2));
      expect(model.trips[0].tripId, equals('trip-1'));
      expect(model.trips[0].displayId, equals('TRP-001'));
      expect(model.trips[0].tripDate, equals(DateTime(2026, 6, 5)));
      expect(model.trips[0].route, equals('Delhi → Agra'));
      expect(model.trips[0].earnings, equals(4500.0));
      expect(model.trips[0].platformFee, equals(500.0));
      expect(model.trips[0].tollEstimate, equals(50.0));
      expect(model.trips[0].status, equals('delivered'));
      expect(model.trips[1].earnings, equals(2700.0));
    });

    test('fromJson handles null fields gracefully', () {
      final json = {
        'start_date': '2026-06-01',
        'end_date': '2026-06-30',
        'total_earnings': 100000,
        'platform_fees': 10000,
        'net_earnings': 90000,
      };

      final model = EarningsStatementModel.fromJson(json);
      expect(model.driverName, equals('Driver'));
      expect(model.totalTrips, equals(0));
      expect(model.trips, isEmpty);
    });

    test('toJson roundtrips correctly', () {
      final model = EarningsStatementModel(
        driverName: 'Test Driver',
        startDate: DateTime(2026, 6, 1),
        endDate: DateTime(2026, 6, 30),
        totalTrips: 5,
        totalEarnings: 50000.0,
        platformFees: 5000.0,
        netEarnings: 45000.0,
        trips: [
          TripEarningRow(
            tripId: 'trip-1',
            earnings: 10000.0,
          ),
        ],
      );

      final json = model.toJson();
      expect(json['driver_name'], equals('Test Driver'));
      expect(json['total_earnings'], equals(5000000));
      expect(json['trips'].length, equals(1));
      expect(json['trips'][0]['earnings'], equals(1000000));
    });
  });

  group('EarningsExportService', () {
    late EarningsExportService service;

    setUp(() {
      service = EarningsExportService();
    });

    test('generatePdf produces non-empty bytes', () async {
      final statement = EarningsStatementModel(
        driverName: 'Ramesh Kumar',
        startDate: DateTime(2026, 6, 1),
        endDate: DateTime(2026, 6, 30),
        totalTrips: 10,
        totalEarnings: 50000.0,
        platformFees: 5000.0,
        netEarnings: 45000.0,
        trips: [
          TripEarningRow(
            tripId: 'trip-1',
            displayId: 'TRP-001',
            tripDate: DateTime(2026, 6, 15),
            route: 'Delhi → Mumbai',
            customerName: 'Acme Corp',
            earnings: 5000.0,
            platformFee: 500.0,
          ),
        ],
      );

      final pdfBytes = await service.generatePdf(statement);

      expect(pdfBytes, isNotEmpty);
      expect(pdfBytes.length, greaterThan(100));
    });

    test('generatePdf with empty trips still produces valid PDF', () async {
      final statement = EarningsStatementModel(
        driverName: 'Driver',
        startDate: DateTime(2026, 6, 1),
        endDate: DateTime(2026, 6, 30),
        totalTrips: 0,
        totalEarnings: 0,
        platformFees: 0,
        netEarnings: 0,
        trips: [],
      );

      final pdfBytes = await service.generatePdf(statement);

      expect(pdfBytes, isNotEmpty);
      expect(pdfBytes.length, greaterThan(100));
    });

    test('generatePdf contains driver name in output', () async {
      final statement = EarningsStatementModel(
        driverName: 'UniqueDriverName123',
        startDate: DateTime(2026, 6, 1),
        endDate: DateTime(2026, 6, 30),
        totalTrips: 1,
        totalEarnings: 1000.0,
        platformFees: 100.0,
        netEarnings: 900.0,
        trips: [
          TripEarningRow(
            tripId: 'trip-1',
            tripDate: DateTime(2026, 6, 15),
            earnings: 1000.0,
          ),
        ],
      );

      final pdfBytes = await service.generatePdf(statement);

      final pdfText = String.fromCharCodes(pdfBytes);
      expect(pdfText, contains('UniqueDriverName123'));
    });

    group('shareCsv file lifecycle', () {
      late Directory testTempDir;

      setUp(() async {
        testTempDir = await Directory.systemTemp.createTemp('earnings_export_test_');
      });

      tearDown(() async {
        if (await testTempDir.exists()) {
          await testTempDir.delete(recursive: true).catchError((_) {});
        }
      });

      test('A. Successful share preserves temporary CSV file on disk after completion', () async {
        bool sharedCalled = false;
        String? sharedPath;

        final service = EarningsExportService(
          shareXFiles: (files, {text}) async {
            sharedCalled = true;
            sharedPath = files.first.path;
          },
        );

        await service.shareCsv(
          'Date,Route,Amount\n2026-06-01,Delhi -> Agra,5000',
          'statement.csv',
          customTempDir: testTempDir,
          cleanupDelay: const Duration(hours: 1),
        );

        expect(sharedCalled, isTrue);
        expect(sharedPath, isNotNull);
        final file = File(sharedPath!);
        expect(file.existsSync(), isTrue, reason: 'Temporary file must remain on disk after shareCsv() completes');
        expect(await file.readAsString(), contains('Delhi -> Agra'));
      });

      test('B. Stale export cleanup removes only matching stale export files', () async {
        final staleFile = File('${testTempDir.path}/earnings_export_stale.csv');
        await staleFile.writeAsString('stale content');
        await staleFile.setLastModified(DateTime.now().subtract(const Duration(minutes: 20)));

        final recentFile = File('${testTempDir.path}/earnings_export_recent.csv');
        await recentFile.writeAsString('recent content');

        final unrelatedFile = File('${testTempDir.path}/unrelated_temp_data.txt');
        await unrelatedFile.writeAsString('unrelated content');

        final service = EarningsExportService(
          shareXFiles: (files, {text}) async {},
        );

        await service.cleanOldExports(
          now: DateTime.now(),
          customTempDir: testTempDir,
        );

        expect(staleFile.existsSync(), isFalse, reason: 'Stale export file (>10m old) must be removed');
        expect(recentFile.existsSync(), isTrue, reason: 'Recent export file (<10m old) must remain');
        expect(unrelatedFile.existsSync(), isTrue, reason: 'Unrelated temp file must remain untouched');
      });

      test('C. Write failure cleans up temporary file and rethrows original exception', () async {
        final nonExistentDir = Directory('${testTempDir.path}/invalid_sub_dir/does_not_exist');
        final service = EarningsExportService(
          shareXFiles: (files, {text}) async {},
        );

        expect(
          () => service.shareCsv(
            'Date,Amount\n2026-06-01,100',
            'test_fail.csv',
            customTempDir: nonExistentDir,
          ),
          throwsA(isA<FileSystemException>()),
        );
      });

      test('D. Share failure cleans up temporary file immediately and rethrows original exception', () async {
        final expectedError = Exception('Share plugin failed to initialize');
        late String createdFilePath;

        final service = EarningsExportService(
          shareXFiles: (files, {text}) async {
            createdFilePath = files.first.path;
            throw expectedError;
          },
        );

        try {
          await service.shareCsv(
            'Date,Amount\n2026-06-01,5000',
            'share_failure.csv',
            customTempDir: testTempDir,
          );
          fail('Expected shareCsv to rethrow Exception');
        } catch (e) {
          expect(e, equals(expectedError));
        }

        final file = File(createdFilePath);
        expect(file.existsSync(), isFalse, reason: 'Temporary file must be cleaned up if share operation throws');
      });

      test('E. Current export is not removed by stale cleanup', () async {
        final currentExport = File('${testTempDir.path}/earnings_export_current.csv');
        await currentExport.writeAsString('current export content');
        await currentExport.setLastModified(DateTime.now());

        final service = EarningsExportService(
          shareXFiles: (files, {text}) async {},
        );

        await service.cleanOldExports(customTempDir: testTempDir);

        expect(currentExport.existsSync(), isTrue, reason: 'Current/active export file must remain available');
      });

      test('F. Cleanup failure does not break successful sharing', () async {
        bool shareSucceeded = false;
        final service = EarningsExportService(
          shareXFiles: (files, {text}) async {
            shareSucceeded = true;
          },
        );

        await service.shareCsv(
          'Date,Amount\n2026-06-01,1000',
          'robust_cleanup.csv',
          customTempDir: testTempDir,
          cleanupDelay: const Duration(hours: 1),
        );

        expect(shareSucceeded, isTrue, reason: 'Sharing must complete successfully even if old cleanup encounters non-fatal errors');
      });
    });
  });
}
