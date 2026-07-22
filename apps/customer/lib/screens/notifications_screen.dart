import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_shared/truxify_shared.dart' as shared;

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key, this.onItemTap});

  /// Called when a notification tile is tapped.
  final ValueChanged<shared.NotificationItem>? onItemTap;

  @override
  Widget build(BuildContext context) {
    final client = Supabase.instance.client;
    final userId = client.auth.currentUser?.id;
    if (userId == null) {
      return const Scaffold(body: Center(child: Text('Please sign in to view notifications.')));
    }
    return shared.NotificationsScreen(
      userId: userId,
      repository: shared.NotificationRepository(client),
      onNotificationTap: (item) {
        final payload = shared.NotificationPayload(
          type: item.notifType,
          title: item.title,
          body: item.body,
        );
        final route = shared.NotificationRouter.resolve(payload);
        shared.NotificationRouter.executeNavigation(context, route);
      },
      repository: NotificationRepository(client),
      onItemTap: onItemTap,
    );
  }
}
