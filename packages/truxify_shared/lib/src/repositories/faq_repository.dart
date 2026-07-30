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
    if (response is! List) {
      throw StateError('Unexpected FAQ response type');
    }

    final rows = response.map((item) {
      if (item is Map<String, dynamic>) return item;
      if (item is Map) return Map<String, dynamic>.from(item);
      throw StateError('Unexpected FAQ item type');
    }).toList(growable: false);
    return rows
        .map(Faq.fromMap)
        .where((faq) => faq.appType == 'both' || faq.appType == appType)
        .toList();
  }
}

