import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_shared/truxify_shared.dart';

void main() {
  group('NotificationRouter (Target-based)', () {
    group('resolveTarget', () {
      test('order_update maps to orderDetail', () {
        final data = {'notifType': 'order_update'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.orderDetail);
      });

      test('delivery_otp maps to orderDetail', () {
        final data = {'notifType': 'delivery_otp'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.orderDetail);
      });

      test('trip_update maps to tripDetail', () {
        final data = {'notifType': 'trip_update'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.tripDetail);
      });

      test('trip_completed maps to tripDetail', () {
        final data = {'notifType': 'trip_completed'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.tripDetail);
      });

      test('payment maps to earnings', () {
        final data = {'notifType': 'payment'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.earnings);
      });

      test('payment_released maps to earnings', () {
        final data = {'notifType': 'payment_released'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.earnings);
      });

      test('load_offer maps to loadDetail', () {
        final data = {'notifType': 'load_offer'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.loadDetail);
      });

      test('system maps to notifications', () {
        final data = {'notifType': 'system'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.notifications);
      });

      test('document maps to notifications', () {
        final data = {'notifType': 'document'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.notifications);
      });

      test('document_expiry maps to documents', () {
        final data = {'notifType': 'document_expiry'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.documents);
      });

      test('unknown type maps to unknown', () {
        final data = {'notifType': 'custom_type'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.unknown);
      });

      test('empty notifType maps to unknown', () {
        final data = <String, dynamic>{};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.unknown);
      });

      test('handles notif_type key (DB format)', () {
        final data = {'notif_type': 'order_update'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.orderDetail);
      });

      test('handles type key (fallback)', () {
        final data = {'type': 'trip_update'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.tripDetail);
      });

      test('case insensitive type matching', () {
        final data = {'notifType': 'ORDER_UPDATE'};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.orderDetail);
      });

      test('handles null type value', () {
        final data = {'notifType': null};
        expect(NotificationRouter.resolveTarget(data), NotificationTarget.unknown);
      });
    });

    group('extractOrderId', () {
      test('extracts from order_display_id', () {
        final data = {'order_display_id': 'ORD-123'};
        expect(NotificationRouter.extractOrderId(data), 'ORD-123');
      });

      test('extracts from orderId', () {
        final data = {'orderId': 'ORD-456'};
        expect(NotificationRouter.extractOrderId(data), 'ORD-456');
      });

      test('returns null when missing', () {
        final data = <String, dynamic>{};
        expect(NotificationRouter.extractOrderId(data), isNull);
      });

      test('prefers order_display_id over orderId', () {
        final data = {'order_display_id': 'ORD-1', 'orderId': 'ORD-2'};
        expect(NotificationRouter.extractOrderId(data), 'ORD-1');
      });

      test('handles non-string values', () {
        final data = {'orderId': 123};
        expect(NotificationRouter.extractOrderId(data), '123');
      });
    });

    group('extractTripId', () {
      test('extracts from trip_id', () {
        final data = {'trip_id': 'T-789'};
        expect(NotificationRouter.extractTripId(data), 'T-789');
      });

      test('extracts from tripId', () {
        final data = {'tripId': 'T-101'};
        expect(NotificationRouter.extractTripId(data), 'T-101');
      });

      test('returns null when missing', () {
        final data = <String, dynamic>{};
        expect(NotificationRouter.extractTripId(data), isNull);
      });
    });

    group('extractBidId', () {
      test('extracts from bid_id', () {
        final data = {'bid_id': 'B-101'};
        expect(NotificationRouter.extractBidId(data), 'B-101');
      });

      test('extracts from load_offer_id', () {
        final data = {'load_offer_id': 'L-202'};
        expect(NotificationRouter.extractBidId(data), 'L-202');
      });

      test('extracts from bidId', () {
        final data = {'bidId': 'B-202'};
        expect(NotificationRouter.extractBidId(data), 'B-202');
      });

      test('prefers bid_id over load_offer_id', () {
        final data = {'bid_id': 'B-1', 'load_offer_id': 'L-2'};
        expect(NotificationRouter.extractBidId(data), 'B-1');
      });

      test('returns null when missing', () {
        final data = <String, dynamic>{};
        expect(NotificationRouter.extractBidId(data), isNull);
      });
    });

    group('navigate callback handling', () {
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
        await NotificationRouter.navigate(data, (target, data) async {
          throw Exception('Navigation failed');
        });
        // Should not throw — the router catches the exception.
      });

      test('catches and logs callback errors', () async {
        final data = {'notifType': 'order_update'};
        // This should not throw even if callback throws
        await NotificationRouter.navigate(data, (target, data) async {
          throw Exception('Test error');
        });
        // If we reach here, the exception was caught
        expect(true, true);
      });
    });

    group('navigateFromItem', () {
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
        });

        expect(receivedTarget, NotificationTarget.orderDetail);
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

    group('navigateFromRemoteMessage', () {
      test('navigates from RemoteMessage data', () async {
        // Mock RemoteMessage
        class MockRemoteMessage {
          final Map<String, dynamic> data;
          MockRemoteMessage(this.data);
        }

        final message = MockRemoteMessage({
          'notifType': 'order_update',
          'order_display_id': 'ORD-1',
        });

        NotificationTarget? receivedTarget;
        await NotificationRouter.navigate(
          Map<String, dynamic>.from(message.data),
          (target, data) async {
            receivedTarget = target;
          },
        );

        expect(receivedTarget, NotificationTarget.orderDetail);
      });
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

    test('orderId getter extracts from metadata', () {
      final item = NotificationItem(
        id: '1',
        title: 'Test',
        body: 'Body',
        notifType: 'order_update',
        isRead: false,
        createdAt: DateTime.now(),
        metadata: {'order_display_id': 'ORD-123'},
      );
      expect(item.orderId, 'ORD-123');
    });

    test('tripId getter extracts from metadata', () {
      final item = NotificationItem(
        id: '1',
        title: 'Test',
        body: 'Body',
        notifType: 'trip_update',
        isRead: false,
        createdAt: DateTime.now(),
        metadata: {'trip_id': 'TRIP-123'},
      );
      expect(item.tripId, 'TRIP-123');
    });

    test('loadOfferId getter extracts from metadata', () {
      final item = NotificationItem(
        id: '1',
        title: 'Test',
        body: 'Body',
        notifType: 'load_offer',
        isRead: false,
        createdAt: DateTime.now(),
        metadata: {'load_offer_id': 'OFFER-123'},
      );
      expect(item.loadOfferId, 'OFFER-123');
    });
  });
}