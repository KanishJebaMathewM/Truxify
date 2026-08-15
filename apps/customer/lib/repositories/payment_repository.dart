import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/payment_method.dart';
import '../services/supabase_service.dart';

class PaymentRepository {
  static const _table = 'payment_methods';

  Future<List<PaymentMethod>> fetchAll() async {
    final userId = SupabaseService.requireUserId();
    final rows = await SupabaseService.client
        .from(_table)
        .select()
        .eq('user_id', userId)
        .order('is_default', ascending: false)
        .order('created_at', ascending: true);
    return (rows as List).map((r) => PaymentMethod.fromMap(r)).toList();
  }

  Future<PaymentMethod> add(PaymentMethod method) async {
    final userId = SupabaseService.requireUserId();
    final payload = method.toMap()..['user_id'] = userId;
    // Always insert as non-default. The default flag is owned exclusively by
    // set_default_payment_method, which clears any existing default and sets
    // this one in a single transaction. Inserting is_default: true here would
    // violate the per-user unique index when a default already exists.
    payload['is_default'] = false;
    final row = await SupabaseService.client
        .from(_table)
        .insert(payload)
        .select()
        .single();
    final savedMethod = PaymentMethod.fromMap(row);
    if (method.isDefault) {
      await _setDefaultRpc(userId, savedMethod.id);
      return savedMethod.copyWith(isDefault: true);
    }
    return savedMethod;
  }

  Future<void> setDefault(String methodId) async {
    final userId = SupabaseService.requireUserId();
    await _setDefaultRpc(userId, methodId);
  }

  Future<void> _setDefaultRpc(String userId, String methodId) async {
    try {
      await SupabaseService.client.rpc(
        'set_default_payment_method',
        params: {
          'p_user_id': userId,
          'p_method_id': methodId,
        },
      );
    } on PostgrestException catch (e) {
      if (e.message.contains('Payment method not found')) {
        throw StateError('Payment method not found.');
      }
      rethrow;
    }
  }

  Future<void> delete(String methodId) async {
    final userId = SupabaseService.requireUserId();
    final existing = await SupabaseService.client
        .from(_table)
        .select('id,is_default')
        .eq('id', methodId)
        .eq('user_id', userId)
        .maybeSingle();

    await SupabaseService.client
        .from(_table)
        .delete()
        .eq('id', methodId)
        .eq('user_id', userId);

    if (existing?['is_default'] != true) {
      return;
    }

    final replacement = await SupabaseService.client
        .from(_table)
        .select('id')
        .eq('user_id', userId)
        .order('created_at', ascending: true)
        .limit(1)
        .maybeSingle();

    final replacementId = replacement?['id']?.toString();
    if (replacementId == null || replacementId.isEmpty) {
      return;
    }

    await SupabaseService.client
        .from(_table)
        .update({'is_default': true})
        .eq('id', replacementId)
        .eq('user_id', userId);
  }
}
