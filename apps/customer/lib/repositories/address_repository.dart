import '../models/saved_address.dart';
import '../services/supabase_service.dart';

class AddressRepository {
  static const _table = 'saved_addresses';

  /// Fetch all addresses for the logged-in user, default first.
  Future<List<SavedAddress>> fetchAll() async {
    final userId = SupabaseService.requireUserId();
    final rows = await SupabaseService.client
        .from(_table)
        .select()
        .eq('user_id', userId)
        .order('is_default', ascending: false)
        .order('created_at', ascending: true);

    return (rows as List).map((r) => SavedAddress.fromMap(r)).toList();
  }

  /// Insert a new address. If it's marked default, demote all others first.
  Future<SavedAddress> add(SavedAddress address) async {
    final userId = SupabaseService.requireUserId();
    if (address.isDefault) await _clearDefaults(userId);

    final payload = address.toMap()..['user_id'] = userId;

    final row = await SupabaseService.client
        .from(_table)
        .insert(payload)
        .select()
        .single();
    return SavedAddress.fromMap(row);
  }

  /// Set an address as the default, clearing all others.
  Future<void> setDefault(String addressId) async {
    final userId = SupabaseService.requireUserId();
    await _clearDefaults(userId);
    await SupabaseService.client
        .from(_table)
        .update({'is_default': true})
        .eq('id', addressId)
        .eq('user_id', userId);
  }

  /// Delete an address by ID.
  Future<void> delete(String addressId) async {
    final userId = SupabaseService.requireUserId();
    await SupabaseService.client
        .from(_table)
        .delete()
        .eq('id', addressId)
        .eq('user_id', userId);
  }

  Future<void> _clearDefaults(String userId) async {
    await SupabaseService.client
        .from(_table)
        .update({'is_default': false}).eq('user_id', userId);
  }
}
