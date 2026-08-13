import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_shared/truxify_shared.dart';
import 'package:truxify_shared/src/models/notification_payload.dart';
import 'package:truxify_shared/src/services/notification_router.dart';

void main() {
  group('payment_released routing consistency', () {
    test('resolveForNotification and resolveTarget agree on earnings', () {
      NotificationRouter.setAppType(NotificationAppType.customer);
      final customerRoute = NotificationRouter.resolve(
        const NotificationPayload(type: 'payment_released'),
      );
      expect(customerRoute, isA<NavigateToWallet>());
      expect(
        NotificationRouter.targetForRoute(customerRoute),
        NotificationTarget.earnings,
      );

      NotificationRouter.setAppType(NotificationAppType.driver);
      final driverRoute = NotificationRouter.resolve(
        const NotificationPayload(type: 'payment_released'),
      );
      expect(driverRoute, isA<NavigateToEarnings>());
      expect(
        NotificationRouter.targetForRoute(driverRoute),
        NotificationTarget.earnings,
      );

      // The in-app target/badge is app-agnostic and must always agree with
      // the route's target for payment_released.
      expect(
        NotificationRouter.resolveTarget({'notifType': 'payment_released'}),
        NotificationTarget.earnings,
      );
    });
  });

  group('resolveForNotification / resolveTarget consistency', () {
    test('every NotificationType handled by resolve has a consistent entry', () {
      NotificationRouter.setAppType(NotificationAppType.customer);

      final cases = <String, NotificationPayload>{
        'order_update': const NotificationPayload(
          type: 'order_update',
          orderId: 'o1',
        ),
        'order_delivered': const NotificationPayload(
          type: 'order_delivered',
          orderId: 'o2',
        ),
        'bid_received': const NotificationPayload(
          type: 'bid_received',
          bidId: 'b1',
        ),
        'payment_released': const NotificationPayload(type: 'payment_released'),
        'support_ticket': const NotificationPayload(
          type: 'support_ticket',
          supportTicketId: 't1',
        ),
        'general_notification': const NotificationPayload(
          type: 'general_notification',
        ),
      };

      for (final entry in cases.entries) {
        final route = NotificationRouter.resolve(entry.value);
        final targetFromRoute = NotificationRouter.targetForRoute(route);
        final target = NotificationRouter.resolveTarget(
          {'notifType': entry.key},
        );

        expect(
          target,
          isNot(NotificationTarget.unknown),
          reason: '${entry.key} is missing a resolveTarget entry',
        );
        expect(
          target,
          targetFromRoute,
          reason: '${entry.key} diverges between resolveForNotification '
              'and resolveTarget',
        );
      }
    });
  });
}
