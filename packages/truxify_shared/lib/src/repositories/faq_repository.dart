import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/faq.dart';

class FaqRepository {
  FaqRepository(this._client);

  final SupabaseClient _client;

  Future<List<Faq>> fetchFaqs(String appType) async {
    final response = await _client
        .from('faqs')
        .select()
        .eq('is_active', true)
        .order('sort_order');
    final rows = response
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList(growable: false);
    return rows
        .map(Faq.fromMap)
        .where((faq) => faq.appType == 'both' || faq.appType == appType)
        .toList();
  }
}

