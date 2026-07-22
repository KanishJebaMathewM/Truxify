import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_shared/truxify_shared.dart';

void main() {
  group('NotificationPayload.fromMap', () {
    test('parses a complete payload correctly', () {
      final data = {
        'type': 'order_update',
        'order_id': 'ord_123',
        'trip_id': 'trip_456',
        'bid_id': 'bid_789',
        'payment_id': 'pay_012',
        'support_ticket_id': 'ticket_345',
        'title': 'Order Updated',
        'body': 'Your order has been updated.',
      };

      final payload = NotificationPayload.fromMap(data);

      expect(payload.type, 'order_update');
      expect(payload.orderId, 'ord_123');
      expect(payload.tripId, 'trip_456');
      expect(payload.bidId, 'bid_789');
      expect(payload.paymentId, 'pay_012');
      expect(payload.supportTicketId, 'ticket_345');
      expect(payload.title, 'Order Updated');
      expect(payload.body, 'Your order has been updated.');
    });

    test('handles null data gracefully', () {
      final payload = NotificationPayload.fromMap(null);
      expect(payload.type, 'unknown');
      expect(payload.orderId, isNull);
      expect(payload.title, isNull);
    });

    test('handles empty map gracefully', () {
      final payload = NotificationPayload.fromMap({});
      expect(payload.type, 'general_notification');
      expect(payload.orderId, isNull);
    });

    test('handles missing optional fields gracefully', () {
      final data = {'type': 'bid_received'};

      final payload = NotificationPayload.fromMap(data);

      expect(payload.type, 'bid_received');
      expect(payload.orderId, isNull);
      expect(payload.tripId, isNull);
      expect(payload.bidId, isNull);
      expect(payload.paymentId, isNull);
      expect(payload.supportTicketId, isNull);
      expect(payload.title, isNull);
      expect(payload.body, isNull);
    });

    test('converts numeric fields to string', () {
      final data = {
        'type': 'order_update',
        'order_id': 12345,
      };

      final payload = NotificationPayload.fromMap(data);

      expect(payload.type, 'order_update');
      expect(payload.orderId, '12345');
    });

    test('preserves rawData', () {
      final data = {
        'type': 'general_notification',
        'custom_field': 'custom_value',
      };

      final payload = NotificationPayload.fromMap(data);

      expect(payload.rawData['custom_field'], 'custom_value');
    });
  });

  group('NotificationPayload.toMap', () {
    test('converts to map correctly', () {
      final payload = NotificationPayload(
        type: 'order_update',
        orderId: 'ord_123',
        title: 'Test Title',
        body: 'Test Body',
      );

      final map = payload.toMap();

      expect(map['type'], 'order_update');
      expect(map['order_id'], 'ord_123');
      expect(map['title'], 'Test Title');
      expect(map['body'], 'Test Body');
      expect(map.containsKey('trip_id'), false);
    });

    test('excludes null fields', () {
      final payload = const NotificationPayload(type: 'general_notification');

      final map = payload.toMap();

      expect(map.containsKey('order_id'), false);
      expect(map.containsKey('title'), false);
      expect(map.length, 1);
    });
  });
}
