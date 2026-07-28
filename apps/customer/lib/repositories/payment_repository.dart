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
    final row = await SupabaseService.client
        .from(_table)
        .insert(payload)
        .select()
        .single();
    final savedMethod = PaymentMethod.fromMap(row);
    if (method.isDefault) {
      await _clearDefaults(userId, exceptId: savedMethod.id);
    }
    return savedMethod;
  }

  Future<void> setDefault(String methodId) async {
    final userId = SupabaseService.requireUserId();
    final existing = await SupabaseService.client
        .from(_table)
        .select('id')
        .eq('id', methodId)
        .eq('user_id', userId)
        .maybeSingle();

    if (existing == null) {
      throw StateError('Payment method not found.');
    }

    await _clearDefaults(userId);
    await SupabaseService.client
        .from(_table)
        .update({'is_default': true})
        .eq('id', methodId)
        .eq('user_id', userId);
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

  Future<void> _clearDefaults(String userId, {String? exceptId}) async {
    var query = SupabaseService.client
        .from(_table)
        .update({'is_default': false})
        .eq('user_id', userId);
    if (exceptId != null) {
      query = query.neq('id', exceptId);
    }
    await query;
  }
}
