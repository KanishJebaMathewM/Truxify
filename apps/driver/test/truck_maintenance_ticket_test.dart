import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/models/truck_models.dart';

void main() {
  group('TruckMaintenanceTicket.fromJson', () {
    test('does not crash on null/absent string fields', () {
      final ticket = TruckMaintenanceTicket.fromJson({
        'id': null,
        'truck_id': null,
        'driver_id': null,
        'category': null,
        'description': null,
        'status': null,
      });
      expect(ticket.id, '');
      expect(ticket.category, '');
      expect(ticket.description, '');
      expect(ticket.status, '');
    });

    test('coerces non-string fields to String', () {
      final ticket = TruckMaintenanceTicket.fromJson({
        'id': 99,
        'truck_id': 101,
        'driver_id': 202,
        'category': 'Engine',
        'description': 'Oil change',
        'status': 'open',
        'photo_urls': ['a', 'b'],
      });
      expect(ticket.id, '99');
      expect(ticket.truckId, '101');
      expect(ticket.driverId, '202');
      expect(ticket.photoUrls, const ['a', 'b']);
    });

    test('handles non-string photo_urls entries gracefully', () {
      final ticket = TruckMaintenanceTicket.fromJson({
        'id': 'ticket-1',
        'truck_id': 't1',
        'driver_id': 'd1',
        'category': 'Engine',
        'description': 'Oil change',
        'status': 'open',
        'photo_urls': [123, true, 'https://example.com/photo.jpg'],
      });
      expect(ticket.photoUrls, const ['123', 'true', 'https://example.com/photo.jpg']);
    });

    test('handles invalid photo_urls type gracefully', () {
      final ticket = TruckMaintenanceTicket.fromJson({
        'id': 'ticket-1',
        'truck_id': 't1',
        'driver_id': 'd1',
        'category': 'Engine',
        'description': 'Oil change',
        'status': 'open',
        'photo_urls': 'not-a-list',
      });
      expect(ticket.photoUrls, const []);
    });
  });
}
