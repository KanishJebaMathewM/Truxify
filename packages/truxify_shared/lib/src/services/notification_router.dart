import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../models/notification_item.dart';
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

/// The screen target determined from a notification payload.
enum NotificationTarget {
  orderDetail,
  tripDetail,
  earnings,
  loadDetail,
  notifications,
  documents,
  unknown,
}

/// Signature for the app-specific navigation callback.
///
/// The callback receives the resolved [target] and the raw [data] map so it
/// can look up any required IDs (orderDisplayId, tripId, etc.) and perform
/// the actual navigation using the app's own navigation framework.
typedef NotificationNavigationCallback = Future<void> Function(
  NotificationTarget target,
  Map<String, dynamic> data,
);

/// Resolves notification payloads into navigation actions.
///
/// This class is intentionally stateless and has only static methods so it
/// can be used from any context without coupling to a specific navigation
/// package or widget tree.
class NotificationRouter {
  NotificationRouter({required this.appType});

  final NotificationAppType appType;

  static NotificationAppType _appType = NotificationAppType.customer;

  /// Sets the app type globally. Should be called once at app startup.
  static void setAppType(NotificationAppType type) {
    _appType = type;
  }

  /// Resolves a [NotificationPayload] to a route based on the globally
  /// configured app type.
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

  // ── FCM / raw data map navigation ──────────────────────────────────────

  /// Resolves the [NotificationTarget] from a raw data map (FCM data payload
  /// or [NotificationItem.metadata]).
  static NotificationTarget resolveTarget(Map<String, dynamic> data) {
    final type = _extractNotifType(data);
    switch (type) {
      case 'order_update':
      case 'delivery_otp':
        return NotificationTarget.orderDetail;
      case 'trip_update':
      case 'trip_completed':
        return NotificationTarget.tripDetail;
      case 'payment':
      case 'payment_released':
        return NotificationTarget.earnings;
      case 'load_offer':
        return NotificationTarget.loadDetail;
      case 'system':
      case 'document':
        return NotificationTarget.notifications;
      case 'document_expiry':
        return NotificationTarget.documents;
      default:
        return NotificationTarget.unknown;
    }
  }

  /// Extracts the order display ID from the data map.
  static String? extractOrderId(Map<String, dynamic> data) {
    return data['order_display_id']?.toString() ??
        data['orderId']?.toString();
  }

  /// Extracts the trip ID from the data map.
  static String? extractTripId(Map<String, dynamic> data) {
    return data['trip_id']?.toString() ?? data['tripId']?.toString();
  }

  /// Extracts the bid/load offer ID from the data map.
  static String? extractBidId(Map<String, dynamic> data) {
    return data['bid_id']?.toString() ??
        data['load_offer_id']?.toString() ??
        data['bidId']?.toString();
  }

  /// Navigates to the appropriate screen using [callback].
  ///
  /// This is the main entry point for both FCM events and notification-list
  /// tap handling.
  static Future<void> navigate(
    Map<String, dynamic> data,
    NotificationNavigationCallback callback,
  ) async {
    final target = resolveTarget(data);
    try {
      await callback(target, data);
    } catch (e) {
      debugPrint('[NotificationRouter] Navigation failed: $e');
    }
  }

  /// Convenience: navigate from a [NotificationItem].
  static Future<void> navigateFromItem(
    NotificationItem item,
    NotificationNavigationCallback callback,
  ) async {
    final data = <String, dynamic>{
      'notifType': item.notifType,
      if (item.metadata != null) ...item.metadata!,
    };
    await navigate(data, callback);
  }

  /// Navigates from a [RemoteMessage]'s data payload.
  static Future<void> navigateFromRemoteMessage(
    RemoteMessage message,
    NotificationNavigationCallback callback,
  ) async {
    await navigate(Map<String, dynamic>.from(message.data), callback);
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /// Extracts the notifType from either a top-level `notifType` key or the
  /// nested `type` key (different backend code paths).
  static String _extractNotifType(Map<String, dynamic> data) {
    return (data['notifType'] ?? data['notif_type'] ?? data['type'] ?? '')
        .toString()
        .toLowerCase();
  }
}
