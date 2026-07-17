import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_shared/truxify_shared.dart';

void main() {
  group('NotificationRouter (customer)', () {
    setUp(() {
      NotificationRouter.setAppType(NotificationAppType.customer);
    });

    test('order_update with orderId returns NavigateToOrderDetail', () {
      final payload = NotificationPayload(
        type: 'order_update',
        orderId: 'ord_123',
      );

      final route = NotificationRouter.resolve(payload);

      expect(route, isA<NavigateToOrderDetail>());
      expect((route as NavigateToOrderDetail).orderId, 'ord_123');
    });

    test('order_update without orderId returns NavigateToNotificationsList', () {
      final payload = const NotificationPayload(type: 'order_update');

      final route = NotificationRouter.resolve(payload);

      expect(route, isA<NavigateToNotificationsList>());
    });

    test('order_delivered with orderId returns NavigateToLiveTracking', () {
      final payload = NotificationPayload(
        type: 'order_delivered',
        orderId: 'ord_456',
      );

      final route = NotificationRouter.resolve(payload);

      expect(route, isA<NavigateToLiveTracking>());
      expect((route as NavigateToLiveTracking).orderId, 'ord_456');
    });

    test('payment_released returns NavigateToWallet for customer', () {
      final payload = const NotificationPayload(type: 'payment_released');

      final route = NotificationRouter.resolve(payload);

      expect(route, isA<NavigateToWallet>());
    });

    test('support_ticket with ticketId returns NavigateToSupportTicket', () {
      final payload = NotificationPayload(
        type: 'support_ticket',
        supportTicketId: 'ticket_001',
      );

      final route = NotificationRouter.resolve(payload);

      expect(route, isA<NavigateToSupportTicket>());
      expect(
        (route as NavigateToSupportTicket).ticketId,
        'ticket_001',
      );
    });

    test('general_notification returns NavigateToNotificationsList', () {
      final payload = const NotificationPayload(type: 'general_notification');

      final route = NotificationRouter.resolve(payload);

      expect(route, isA<NavigateToNotificationsList>());
    });

    test('unknown notification type returns NavigateToNotificationsList', () {
      final payload = const NotificationPayload(type: 'some_unknown_type');

      final route = NotificationRouter.resolve(payload);

      expect(route, isA<NavigateToNotificationsList>());
    });

    test('bid_received with bidId returns NavigateToLoadDetail', () {
      final payload = NotificationPayload(
        type: 'bid_received',
        bidId: 'bid_789',
      );

      final route = NotificationRouter.resolve(payload);

      expect(route, isA<NavigateToLoadDetail>());
      expect((route as NavigateToLoadDetail).bidId, 'bid_789');
    });
  });

  group('NotificationRouter (driver)', () {
    setUp(() {
      NotificationRouter.setAppType(NotificationAppType.driver);
    });

    test('payment_released returns NavigateToEarnings for driver', () {
      final payload = const NotificationPayload(type: 'payment_released');

      final route = NotificationRouter.resolve(payload);

      expect(route, isA<NavigateToEarnings>());
    });

    test('order_update returns NavigateToOrderDetail', () {
      final payload = NotificationPayload(
        type: 'order_update',
        orderId: 'ord_123',
      );

      final route = NotificationRouter.resolve(payload);

      expect(route, isA<NavigateToOrderDetail>());
    });
  });

  group('NotificationRouter static callback', () {
    setUp(() {
      NotificationRouter.clearNavigateCallback();
    });

    test('isCallbackRegistered returns false when not registered', () {
      expect(NotificationRouter.isCallbackRegistered, false);
    });

    test('registerNavigateCallback sets callback', () {
      final callback = (BuildContext context, NotificationRoute route) {};
      NotificationRouter.registerNavigateCallback(callback);
      expect(NotificationRouter.isCallbackRegistered, true);
    });

    test('clearNavigateCallback clears callback', () {
      final callback = (BuildContext context, NotificationRoute route) {};
      NotificationRouter.registerNavigateCallback(callback);
      NotificationRouter.clearNavigateCallback();
      expect(NotificationRouter.isCallbackRegistered, false);
    });
  });

  group('NotificationRoute sealed class', () {
    test('NavigateToOrderDetail holds orderId', () {
      const route = NavigateToOrderDetail('ord_123');
      expect(route.orderId, 'ord_123');
    });

    test('NavigateToLiveTracking holds orderId', () {
      const route = NavigateToLiveTracking('ord_456');
      expect(route.orderId, 'ord_456');
    });

    test('NavigateToLoadDetail holds bidId', () {
      const route = NavigateToLoadDetail('bid_789');
      expect(route.bidId, 'bid_789');
    });

    test('NavigateToSupportTicket holds ticketId', () {
      const route = NavigateToSupportTicket('ticket_001');
      expect(route.ticketId, 'ticket_001');
    });
  });

  group('NotificationRouter instance API', () {
    test('resolvePayload uses instance appType', () {
      final router = NotificationRouter(appType: NotificationAppType.customer);

      final route = router.resolvePayload(
        const NotificationPayload(type: 'payment_released'),
      );

      expect(route, isA<NavigateToWallet>());
    });

    test('resolvePayload returns earnings for driver', () {
      final router = NotificationRouter(appType: NotificationAppType.driver);

      final route = router.resolvePayload(
        const NotificationPayload(type: 'payment_released'),
      );

      expect(route, isA<NavigateToEarnings>());
    });
  });
}
