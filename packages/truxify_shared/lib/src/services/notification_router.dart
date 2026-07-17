import 'package:flutter/material.dart';

import '../models/notification_payload.dart';

/// Defines which app is using the router so it navigates to the correct
/// screens when a notification is tapped.
enum NotificationAppType { customer, driver }

/// Result of parsing and resolving a notification tap.
sealed class NotificationRoute {
  const NotificationRoute();
}

class NavigateToOrderDetail extends NotificationRoute {
  const NavigateToOrderDetail(this.orderId);
  final String orderId;
}

class NavigateToLiveTracking extends NotificationRoute {
  const NavigateToLiveTracking(this.orderId);
  final String orderId;
}

class NavigateToLoadDetail extends NotificationRoute {
  const NavigateToLoadDetail(this.bidId);
  final String bidId;
}

class NavigateToWallet extends NotificationRoute {
  const NavigateToWallet();
}

class NavigateToEarnings extends NotificationRoute {
  const NavigateToEarnings();
}

class NavigateToSupportTicket extends NotificationRoute {
  const NavigateToSupportTicket(this.ticketId);
  final String ticketId;
}

class NavigateToNotificationsList extends NotificationRoute {
  const NavigateToNotificationsList();
}

/// Resolves a [NotificationPayload] into a [NotificationRoute] action.
class NotificationRouter {
  NotificationRouter({required this.appType});

  final NotificationAppType appType;

  static NotificationAppType _appType = NotificationAppType.customer;

  /// Sets the app type globally. Should be called once at app startup.
  static void setAppType(NotificationAppType type) {
    _appType = type;
  }

  /// Resolves a payload to a route based on the globally configured app type.
  static NotificationRoute resolve(NotificationPayload payload) {
    return _resolveForAppType(payload, _appType);
  }

  /// Instance method for backward compatibility.
  NotificationRoute resolvePayload(NotificationPayload payload) {
    return _resolveForAppType(payload, appType);
  }

  static NotificationRoute _resolveForAppType(
    NotificationPayload payload,
    NotificationAppType appType,
  ) {
    switch (payload.type) {
      case 'order_update':
        if (payload.orderId != null) {
          return NavigateToOrderDetail(payload.orderId!);
        }
        return const NavigateToNotificationsList();

      case 'order_delivered':
        if (payload.orderId != null) {
          return NavigateToLiveTracking(payload.orderId!);
        }
        return const NavigateToNotificationsList();

      case 'bid_received':
        if (payload.bidId != null) {
          return NavigateToLoadDetail(payload.bidId!);
        }
        return const NavigateToNotificationsList();

      case 'payment_released':
        switch (appType) {
          case NotificationAppType.customer:
            return const NavigateToWallet();
          case NotificationAppType.driver:
            return const NavigateToEarnings();
        }

      case 'support_ticket':
        if (payload.supportTicketId != null) {
          return NavigateToSupportTicket(payload.supportTicketId!);
        }
        return const NavigateToNotificationsList();

      case 'general_notification':
      default:
        return const NavigateToNotificationsList();
    }
  }

  /// Callback type used by apps to perform the actual navigation.
  /// Each app provides its own implementation.
  static void Function(BuildContext context, NotificationRoute route)? _navigateCallback;

  /// Registers a callback that performs the actual navigation for a route.
  /// Each app (customer/driver) registers its own implementation.
  static void registerNavigateCallback(
    void Function(BuildContext context, NotificationRoute route) callback,
  ) {
    _navigateCallback = callback;
  }

  static void clearNavigateCallback() {
    _navigateCallback = null;
  }

  static bool get isCallbackRegistered => _navigateCallback != null;

  /// Executes navigation by invoking the registered callback.
  /// The [context] is used by the app's callback to push routes.
  static void executeNavigation(BuildContext context, NotificationRoute route) {
    final callback = _navigateCallback;
    if (callback != null) {
      callback(context, route);
    } else {
      debugPrint('[NotificationRouter] No navigation callback registered.');
    }
  }
}
