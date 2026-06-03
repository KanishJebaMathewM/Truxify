import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/support_ticket.dart';

class SupportRepository {
  SupportRepository(this._client);

  final SupabaseClient _client;

  Future<void> createSupportTicket({
    String? userId,
    required String subject,
    required String description,
    required String category,
  }) async {
    final ticket = SupportTicket(
      id: '',
      userId: userId,
      subject: subject,
      description: description,
      category: category,
      status: 'open',
    );
    await _client.from('support_tickets').insert(ticket.toInsertMap());
  }
}

