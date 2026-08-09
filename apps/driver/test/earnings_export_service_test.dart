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
  });
}
