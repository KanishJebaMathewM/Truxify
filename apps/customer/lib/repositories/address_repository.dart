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
    final payload = address.toMap()..['user_id'] = userId;

    final row = await SupabaseService.client
        .from(_table)
        .insert(payload)
        .select()
        .single();
    final savedAddress = SavedAddress.fromMap(row);
    if (address.isDefault) {
      await _clearDefaults(userId, exceptId: savedAddress.id);
    }
    return savedAddress;
  }

  /// Set an address as the default, clearing all others.
  Future<void> setDefault(String addressId) async {
    final userId = SupabaseService.requireUserId();
    final existing = await SupabaseService.client
        .from(_table)
        .select('id')
        .eq('id', addressId)
        .eq('user_id', userId)
        .maybeSingle();

    if (existing == null) {
      throw StateError('Address not found.');
    }

    await _clearDefaults(userId, exceptId: addressId);
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

class AddressValidator {
  static const int maxAddresses = 20;
  static const int minLength = 5;
  static const int maxLength = 500;

  static bool isValid(String addr) {
    final trimmed = addr.trim();
    if (trimmed.length < minLength || trimmed.length > maxLength) return false;
    if (!trimmed.contains(RegExp(r'[a-zA-Z]'))) return false;
    return true;
  }

  static String normalizeLabel(String label) {
    return label.trim().toLowerCase().replaceAll(RegExp(r'\s+'), '_');
  }

  static bool isDuplicate(String existing, String newLabel) {
    return normalizeLabel(existing) == normalizeLabel(newLabel);
  }

  static String truncate(String addr, int maxLen) {
    if (addr.length <= maxLen) return addr;
    return addr.substring(0, maxLen - 3) + '...';
  }
}
