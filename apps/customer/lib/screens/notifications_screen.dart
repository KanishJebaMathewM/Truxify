import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_shared/truxify_shared.dart';
import 'package:truxify_shared/truxify_shared.dart' as shared;

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final client = Supabase.instance.client;
    final userId = client.auth.currentUser?.id;
    if (userId == null) {
      return const Scaffold(body: Center(child: Text('Please sign in to view notifications.')));
    }
    return shared.NotificationsScreen(
      userId: userId,
      repository: NotificationRepository(client),
    );
  }
}
