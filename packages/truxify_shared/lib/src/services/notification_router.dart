import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../models/notification_item.dart';

/// The screen target determined from a notification payload.
enum NotificationTarget {
  orderDetail,
  tripDetail,
  earnings,
  loadDetail,
  notifications,
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

/// Parses notification payloads and dispatches navigation via a callback.
///
/// This class is intentionally stateless and has only static methods so it
/// can be used from any context without coupling to a specific navigation
/// package or widget tree.
class NotificationRouter {
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
