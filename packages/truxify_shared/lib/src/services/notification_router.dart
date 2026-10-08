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
  wallet,
  earnings,
  loadDetail,
  notifications,
  documents,
  unknown,
}

/// Single source of truth mapping a notification type to the in-app
/// [NotificationTarget] used for badge/consumption tracking.
///
/// `payment_released` is intentionally not listed here because it is
/// app-specific (see [resolveTarget]); every other type is derived from this
/// map so the deep-link target and the in-app target/badge never diverge.
const Map<String, NotificationTarget> _targetByType = {
  'order_update': NotificationTarget.orderDetail,
  'order_delivered': NotificationTarget.tripDetail,
  'delivery_otp': NotificationTarget.orderDetail,
  'trip_update': NotificationTarget.tripDetail,
  'trip_completed': NotificationTarget.tripDetail,
  'payment': NotificationTarget.earnings,
  'bid_received': NotificationTarget.loadDetail,
  'load_offer': NotificationTarget.loadDetail,
  'support_ticket': NotificationTarget.notifications,
  'system': NotificationTarget.notifications,
  'document': NotificationTarget.notifications,
  'document_expiry': NotificationTarget.documents,
  'general_notification': NotificationTarget.notifications,
};

/// Signature for the app-specific navigation callback.
///
/// The callback receives the resolved [target] and the raw [data] map so it
/// can look up any required IDs (orderDisplayId, tripId, etc.) and perform
/// the actual navigation using the app's own navigation framework.
typedef NotificationNavigationCallback = Future<void> Function(
  NotificationTarget target,
  Map<String, dynamic> data,
);

/// Parses notification payloads and dispatches navigation.
class NotificationRouter {
  NotificationRouter({required this.appType});

  final NotificationAppType appType;

  static NotificationAppType _appType = NotificationAppType.customer;

  static void Function(BuildContext context, NotificationRoute route)?
      _navigateCallback;

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
      case 'delivery_otp':
        if (payload.orderId != null) {
          return NavigateToOrderDetail(payload.orderId!);
        }
        return const NavigateToNotificationsList();

      case 'order_delivered':
      case 'trip_update':
      case 'trip_completed':
        if (payload.orderId != null) {
          return NavigateToLiveTracking(payload.orderId!);
        }
        return const NavigateToNotificationsList();

      case 'bid_received':
      case 'load_offer':
        if (payload.bidId != null) {
          return NavigateToLoadDetail(payload.bidId!);
        }
        return const NavigateToNotificationsList();

      case 'payment':
        return const NavigateToEarnings();

      case 'payment_released':
        return appType == NotificationAppType.customer
            ? const NavigateToWallet()
            : const NavigateToEarnings();

      case 'support_ticket':
        if (payload.supportTicketId != null) {
          return NavigateToSupportTicket(payload.supportTicketId!);
        }
        return const NavigateToNotificationsList();

      case 'system':
      case 'document':
      case 'document_expiry':
      case 'general_notification':
      default:
        return const NavigateToNotificationsList();
    }
  }

  /// Registers a callback that performs the actual navigation for a route.
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
  static void executeNavigation(BuildContext context, NotificationRoute route) {
    final callback = _navigateCallback;
    if (callback != null) {
      callback(context, route);
    } else {
      debugPrint('[NotificationRouter] No navigation callback registered.');
    }
  }

  /// Resolves the [NotificationTarget] from a raw data map (FCM data payload
  /// or [NotificationItem.metadata]).
  ///
  /// Mirrors [_resolveForAppType] so the FCM-tap path used by
  /// [navigateFromRemoteMessage] agrees with the in-app route resolver on
  /// every type. `payment_released` is app-specific: customers land on the
  /// wallet target, drivers on earnings.
  static NotificationTarget resolveTarget(Map<String, dynamic> data) {
    final type = _extractNotifType(data);
    if (type == 'payment_released') {
      return _appType == NotificationAppType.customer
          ? NotificationTarget.wallet
          : NotificationTarget.earnings;
    }
    return _targetByType[type] ?? NotificationTarget.unknown;
  }

  /// Maps a resolved [NotificationRoute] back to its in-app
  /// [NotificationTarget].
  ///
  /// This is the canonical route→target mapping and is the counterpart to
  /// [resolveTarget]; the consistency regression test guarantees the two never
  /// drift apart.
  static NotificationTarget targetForRoute(NotificationRoute route) {
    if (route is NavigateToOrderDetail) return NotificationTarget.orderDetail;
    if (route is NavigateToLiveTracking) return NotificationTarget.tripDetail;
    if (route is NavigateToLoadDetail) return NotificationTarget.loadDetail;
    if (route is NavigateToWallet) return NotificationTarget.wallet;
    if (route is NavigateToEarnings) return NotificationTarget.earnings;
    if (route is NavigateToSupportTicket) {
      return NotificationTarget.notifications;
    }
    if (route is NavigateToNotificationsList) {
      return NotificationTarget.notifications;
    }
    return NotificationTarget.unknown;
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

  /// Convenience: navigate from an [NotificationItem].
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

  /// Navigates from an [RemoteMessage]'s data payload.
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
