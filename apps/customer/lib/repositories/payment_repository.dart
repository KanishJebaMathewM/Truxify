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
    if (method.isDefault) await _clearDefaults(userId);
    final payload = method.toMap()..['user_id'] = userId;
    final row = await SupabaseService.client
        .from(_table)
        .insert(payload)
        .select()
        .single();
    return PaymentMethod.fromMap(row);
  }

  Future<void> setDefault(String methodId) async {
    final userId = SupabaseService.requireUserId();
    await _clearDefaults(userId);
    await SupabaseService.client
        .from(_table)
        .update({'is_default': true})
        .eq('id', methodId)
        .eq('user_id', userId);
  }

  Future<void> delete(String methodId) async {
    final userId = SupabaseService.requireUserId();
    await SupabaseService.client
        .from(_table)
        .delete()
        .eq('id', methodId)
        .eq('user_id', userId);
  }

  Future<void> _clearDefaults(String userId) async {
    await SupabaseService.client
        .from(_table)
        .update({'is_default': false})
        .eq('user_id', userId);
  }
}