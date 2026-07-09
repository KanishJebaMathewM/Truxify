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
    final List<Map<String, dynamic>> rows = response is List
        ? List<Map<String, dynamic>>.from(response)
        : <Map<String, dynamic>>[];
    return rows
        .map(Faq.fromMap)
        .where((faq) => faq.appType == 'both' || faq.appType == appType)
        .toList();
  }
}

