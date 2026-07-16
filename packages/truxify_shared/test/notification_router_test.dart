import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_shared/src/models/notification_item.dart';
import 'package:truxify_shared/src/services/notification_router.dart';

void main() {
  group('NotificationRouter.resolveTarget', () {
    test('resolves order_update to orderDetail', () {
      final data = {'notifType': 'order_update', 'order_display_id': 'ORD-1'};
      expect(
        NotificationRouter.resolveTarget(data),
        NotificationTarget.orderDetail,
      );
    });

    test('resolves delivery_otp to orderDetail', () {
      final data = {'notifType': 'delivery_otp', 'orderDisplayId': 'ORD-2'};
      expect(
        NotificationRouter.resolveTarget(data),
        NotificationTarget.orderDetail,
      );
    });

    test('resolves trip_update to tripDetail', () {
      final data = {'notifType': 'trip_update', 'trip_id': 'T-1'};
      expect(
        NotificationRouter.resolveTarget(data),
        NotificationTarget.tripDetail,
      );
    });

    test('resolves trip_completed to tripDetail', () {
      final data = {'notifType': 'trip_completed'};
      expect(
        NotificationRouter.resolveTarget(data),
        NotificationTarget.tripDetail,
      );
    });

    test('resolves payment to earnings', () {
      final data = {'notifType': 'payment'};
      expect(
        NotificationRouter.resolveTarget(data),
        NotificationTarget.earnings,
      );
    });

    test('resolves payment_released to earnings', () {
      final data = {'notifType': 'payment_released'};
      expect(
        NotificationRouter.resolveTarget(data),
        NotificationTarget.earnings,
      );
    });

    test('resolves load_offer to loadDetail', () {
      final data = {'notifType': 'load_offer', 'bid_id': 'B-1'};
      expect(
        NotificationRouter.resolveTarget(data),
        NotificationTarget.loadDetail,
      );
    });

    test('resolves system to notifications', () {
      final data = {'notifType': 'system'};
      expect(
        NotificationRouter.resolveTarget(data),
        NotificationTarget.notifications,
      );
    });

    test('resolves document to notifications', () {
      final data = {'notifType': 'document'};
      expect(
        NotificationRouter.resolveTarget(data),
        NotificationTarget.notifications,
      );
    });

    test('resolves unknown type to unknown', () {
      final data = {'notifType': 'custom_type'};
      expect(
        NotificationRouter.resolveTarget(data),
        NotificationTarget.unknown,
      );
    });

    test('resolves empty notifType to unknown', () {
      final data = <String, dynamic>{};
      expect(
        NotificationRouter.resolveTarget(data),
        NotificationTarget.unknown,
      );
    });

    test('handles notif_type key (DB format)', () {
      final data = {'notif_type': 'order_update'};
      expect(
        NotificationRouter.resolveTarget(data),
        NotificationTarget.orderDetail,
      );
    });

    test('handles type key (fallback)', () {
      final data = {'type': 'trip_update'};
      expect(
        NotificationRouter.resolveTarget(data),
        NotificationTarget.tripDetail,
      );
    });
  });

  group('NotificationRouter ID extraction', () {
    test('extractOrderId from order_display_id', () {
      final data = {'order_display_id': 'ORD-123'};
      expect(NotificationRouter.extractOrderId(data), 'ORD-123');
    });

    test('extractOrderId from orderId', () {
      final data = {'orderId': 'ORD-456'};
      expect(NotificationRouter.extractOrderId(data), 'ORD-456');
    });

    test('extractOrderId returns null when missing', () {
      final data = <String, dynamic>{};
      expect(NotificationRouter.extractOrderId(data), isNull);
    });

    test('extractTripId from trip_id', () {
      final data = {'trip_id': 'T-789'};
      expect(NotificationRouter.extractTripId(data), 'T-789');
    });

    test('extractTripId returns null when missing', () {
      final data = <String, dynamic>{};
      expect(NotificationRouter.extractTripId(data), isNull);
    });

    test('extractBidId from bid_id', () {
      final data = {'bid_id': 'B-101'};
      expect(NotificationRouter.extractBidId(data), 'B-101');
    });

    test('extractBidId from load_offer_id', () {
      final data = {'load_offer_id': 'L-202'};
      expect(NotificationRouter.extractBidId(data), 'L-202');
    });
  });

  group('NotificationRouter.navigate', () {
    test('calls callback with correct target and data', () async {
      final data = {'notifType': 'order_update', 'order_display_id': 'ORD-1'};
      NotificationTarget? receivedTarget;
      Map<String, dynamic>? receivedData;

      await NotificationRouter.navigate(data, (target, d) async {
        receivedTarget = target;
        receivedData = d;
      });

      expect(receivedTarget, NotificationTarget.orderDetail);
      expect(receivedData?['order_display_id'], 'ORD-1');
    });

    test('does not throw on callback error', () async {
      final data = {'notifType': 'system'};
      await NotificationRouter.navigate(data, (target, d) async {
        throw Exception('Navigation failed');
      });
      // Should not throw — the router catches the exception.
    });
  });

  group('NotificationRouter.navigateFromItem', () {
    test('navigates from NotificationItem with metadata', () async {
      final item = NotificationItem(
        id: 'n-1',
        title: 'Test',
        body: 'Body',
        notifType: 'order_update',
        isRead: false,
        createdAt: DateTime.now(),
        metadata: {'order_display_id': 'ORD-99'},
      );

      NotificationTarget? receivedTarget;
      String? receivedOrderId;

      await NotificationRouter.navigateFromItem(item, (target, data) async {
        receivedTarget = target;
        receivedOrderId = NotificationRouter.extractOrderId(data);
      });

      expect(receivedTarget, NotificationTarget.orderDetail);
      expect(receivedOrderId, 'ORD-99');
    });

    test('navigates from NotificationItem without metadata', () async {
      final item = NotificationItem(
        id: 'n-2',
        title: 'System',
        body: 'Info',
        notifType: 'system',
        isRead: false,
        createdAt: DateTime.now(),
      );

      NotificationTarget? receivedTarget;

      await NotificationRouter.navigateFromItem(item, (target, data) async {
        receivedTarget = target;
      });

      expect(receivedTarget, NotificationTarget.notifications);
    });
  });

  group('NotificationItem', () {
    test('fromMap parses metadata', () {
      final map = {
        'id': '1',
        'title': 'Test',
        'body': 'Body',
        'notif_type': 'order_update',
        'is_read': false,
        'created_at': '2026-01-15T10:00:00Z',
        'metadata': {'order_display_id': 'ORD-1'},
      };

      final item = NotificationItem.fromMap(map);
      expect(item.metadata, isNotNull);
      expect(item.metadata!['order_display_id'], 'ORD-1');
      expect(item.orderId, 'ORD-1');
    });

    test('fromMap handles null metadata', () {
      final map = {
        'id': '2',
        'title': 'Test',
        'body': 'Body',
        'notif_type': 'system',
        'is_read': true,
        'created_at': '2026-01-15T10:00:00Z',
      };

      final item = NotificationItem.fromMap(map);
      expect(item.metadata, isNull);
      expect(item.orderId, isNull);
    });

    test('copyWith preserves unchanged fields', () {
      final original = NotificationItem(
        id: '1',
        title: 'Title',
        body: 'Body',
        notifType: 'order_update',
        isRead: false,
        createdAt: DateTime(2026, 1, 15),
        metadata: {'key': 'value'},
      );

      final updated = original.copyWith(isRead: true);
      expect(updated.id, original.id);
      expect(updated.title, original.title);
      expect(updated.isRead, true);
      expect(updated.metadata, original.metadata);
    });
  });
}
