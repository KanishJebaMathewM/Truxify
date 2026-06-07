import 'package:supabase_flutter/supabase_flutter.dart';

class DriverEarningsService {
  DriverEarningsService({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;

  String? get driverId => _client.auth.currentUser?.id;

  Future<List<Map<String, dynamic>>> fetchWalletTransactions() async {
    if (driverId == null) return [];

    final response = await _client
        .from('wallet_transactions')
        .select()
        .eq('driver_id', driverId!)
        .order('created_at', ascending: false);

    return List<Map<String, dynamic>>.from(response);
  }

  Future<List<Map<String, dynamic>>> fetchMonthlyEarnings({
    required DateTime month,
  }) async {
    if (driverId == null) return [];

    final start = DateTime(month.year, month.month, 1);
    final end = DateTime(month.year, month.month + 1, 1);

    final response = await _client
        .from('earnings_daily')
        .select()
        .eq('driver_id', driverId!)
        .gte('day_date', start.toIso8601String().split('T').first)
        .lt('day_date', end.toIso8601String().split('T').first)
        .order('day_date');

    return List<Map<String, dynamic>>.from(response);
  }

  Future<List<Map<String, dynamic>>> fetchCompletedTripsForDay({
    required DateTime date,
  }) async {
    if (driverId == null) return [];

    final day = date.toIso8601String().split('T').first;

    final response = await _client
        .from('trips')
        .select()
        .eq('driver_id', driverId!)
        .eq('status', 'completed')
        .eq('trip_date', day)
        .order('created_at', ascending: false);

    return List<Map<String, dynamic>>.from(response);
  }
}
