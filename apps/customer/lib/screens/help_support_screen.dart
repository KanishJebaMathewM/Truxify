import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_shared/truxify_shared.dart';

class HelpSupportScreen extends StatelessWidget {
  const HelpSupportScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final client = Supabase.instance.client;
    return HelpCenterScreen(
      appType: 'customer',
      userId: client.auth.currentUser?.id,
      faqRepository: FaqRepository(client),
      supportRepository: SupportRepository(client),
      title: 'Help & Support',
    );
  }
}
