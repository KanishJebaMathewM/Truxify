import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import 'notification_router.dart';

/// Handles foreground FCM messages by showing a Material banner.
///
/// Call [setup] once from the shell screen's `initState`. The banner includes
/// a "View" action that invokes [onTap] with the notification's data payload.
class ForegroundNotificationHandler {
  ForegroundNotificationHandler._();

  static StreamSubscription<RemoteMessage>? _subscription;

  /// Begins listening for foreground messages.
  ///
  /// [context] must be the shell screen's `BuildContext` (stays alive for the
  /// app's lifetime). [onTap] is called when the user taps "View".
  static void setup({
    required BuildContext context,
    required NotificationNavigationCallback onTap,
  }) {
    _subscription?.cancel();
    _subscription = FirebaseMessaging.onMessage.listen((message) {
      if (!context.mounted) return;
      _showBanner(context: context, message: message, onTap: onTap);
    });
  }

  /// Cancels the foreground listener. Call in `dispose`.
  static void dispose() {
    _subscription?.cancel();
    _subscription = null;
  }

  /// Handles a cold-start (app terminated) notification tap.
  static Future<void> handleInitialMessage({
    required NotificationNavigationCallback onTap,
  }) async {
    final message = await FirebaseMessaging.instance.getInitialMessage();
    if (message == null) return;
    await NotificationRouter.navigateFromRemoteMessage(message, onTap);
  }

  /// Handles a background notification tap (app in background, not killed).
  static void handleBackgroundTap({
    required NotificationNavigationCallback onTap,
  }) {
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      NotificationRouter.navigateFromRemoteMessage(message, onTap);
    });
  }

  // ── Private ───────────────────────────────────────────────────────────

  static void _showBanner({
    required BuildContext context,
    required RemoteMessage message,
    required NotificationNavigationCallback onTap,
  }) {
    final title = message.notification?.title ?? 'New notification';
    final body = message.notification?.body ?? '';

    ScaffoldMessenger.of(context).hideCurrentMaterialBanner();
    ScaffoldMessenger.of(context).showMaterialBanner(
      MaterialBanner(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        leading: const Icon(Icons.notifications_rounded),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        content: Text(body, maxLines: 2, overflow: TextOverflow.ellipsis),
        actions: [
          TextButton(
            onPressed: () {
              ScaffoldMessenger.of(context).hideCurrentMaterialBanner();
              NotificationRouter.navigate(
                Map<String, dynamic>.from(message.data),
                onTap,
              );
            },
            child: const Text('View'),
          ),
          TextButton(
            onPressed: () =>
                ScaffoldMessenger.of(context).hideCurrentMaterialBanner(),
            child: const Text('Dismiss'),
          ),
        ],
      ),
    );

    // Auto-dismiss after 8 seconds.
    Future.delayed(const Duration(seconds: 8), () {
      if (context.mounted) {
        ScaffoldMessenger.of(context).hideCurrentMaterialBanner();
      }
    });
  }
}
