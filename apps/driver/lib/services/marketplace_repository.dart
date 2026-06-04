import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/app_models.dart';
import '../models/marketplace_models.dart';

class MarketplaceRepository {
  MarketplaceRepository({SupabaseClient? client}) : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;

  Future<List<LoadOffer>> fetchLoadOffers() async {
    final rows = await _client
        .from('load_offers')
        .select()
        .eq('is_en_route', false)
        .order('created_at', ascending: false);

    return rows.whereType<Map<String, dynamic>>().map(_mapLoadOffer).toList(growable: false);
  }

  Future<List<LoadOffer>> fetchEnRouteLoads() async {
    final rows = await _client
        .from('load_offers')
        .select()
        .eq('is_en_route', true)
        .order('created_at', ascending: false);

    return rows.whereType<Map<String, dynamic>>().map(_mapLoadOffer).toList(growable: false);
  }

  Future<DriverBid> submitBid({
    required String loadId,
    required String driverId,
    required num amount,
  }) async {
    final inserted = await _client
        .from('load_bids')
        .insert(<String, dynamic>{
          'load_id': loadId,
          'driver_id': driverId,
          'bid_amount': (amount * 100).round(),
        })
        .select()
        .single();
    return DriverBid.fromJson(inserted);
  }

  Future<List<DriverBid>> fetchDriverBids({required String driverId}) async {
    final rows = await _client.from('load_bids').select().eq('driver_id', driverId).order('created_at', ascending: false);
    return rows.whereType<Map<String, dynamic>>().map(DriverBid.fromJson).toList(growable: false);
  }

  LoadOffer _mapLoadOffer(Map<String, dynamic> row) {
    String s(String key, [String fallback = '']) => (row[key] ?? fallback).toString();
    num n(String key, [num fallback = 0]) => (row[key] as num?) ?? fallback;
    double d(String key, [double fallback = 0]) => (row[key] as num?)?.toDouble() ?? fallback;
    int i(String key, [int fallback = 0]) => (row[key] as num?)?.toInt() ?? fallback;
    bool b(String key, [bool fallback = false]) => (row[key] as bool?) ?? fallback;

    final freightValue = row.containsKey('freight_value')
        ? _formatCurrency(n('freight_value'))
        : (row.containsKey('freightValue') ? s('freightValue') : s('freight_value', '₹0'));
    final netProfit = row.containsKey('net_profit')
        ? _formatCurrency(n('net_profit'))
        : (row.containsKey('netProfit') ? s('netProfit') : s('net_profit', '₹0'));

    final estimatedProfit = row.containsKey('estimated_profit')
        ? _formatCurrency(n('estimated_profit'))
        : (row.containsKey('estimatedProfit') ? s('estimatedProfit') : s('estimated_profit', netProfit));

    final isBestProfit = b('is_best_profit', b('best_profit', false));

    return LoadOffer(
      id: s('id'),
      route: s('route', s('route_label')),
      routeSubtitle: s('route_subtitle'),
      customer: s('customer_name', s('customer', 'Customer')),
      company: s('company_name', s('company', 'Company')),
      goods: s('goods_type', s('goods', 'Goods')),
      pickup: s('pickup_address', s('pickup_location', s('pickup', 'Pickup'))),
      distanceFromDriver: s('distance_from_driver', '—'),
      estimatedProfit: estimatedProfit,
      fuelCost: row.containsKey('fuel_cost') ? _formatCurrency(n('fuel_cost')) : s('fuelCost', '₹0'),
      tollCost: row.containsKey('toll_cost') ? _formatCurrency(n('toll_cost')) : s('tollCost', '₹0'),
      capacityUsed: d('capacity_used', 0.0),
      truckFillLabel: s('truck_fill_label', 'Capacity'),
      sharingTruckWith: s('sharing_truck_with', '—'),
      badgeLabel: s('badge_label', isBestProfit ? 'Best Profit' : 'Available'),
      badgeEmoji: s('badge_emoji', isBestProfit ? '💰' : '📦'),
      bestProfit: isBestProfit,
      routeDistance: s('route_distance', '—'),
      routeDuration: s('route_duration', '—'),
      weight: row.containsKey('weight_kg') ? '${n('weight_kg')} kg' : s('weight', '—'),
      dimensions: s('dimensions', '—'),
      stackable: s('stackable', '—'),
      fragile: s('fragile', '—'),
      specialHandling: s('special_handling'),
      freightValue: freightValue,
      netProfit: netProfit,
      routeNote: s('route_note'),
      extraDistance: i('extra_distance_km', 0),
      extraEarnings: row.containsKey('extra_earnings')
          ? _formatCurrency(n('extra_earnings'))
          : s('extraEarnings', '₹0'),
      spaceAvailable: s('space_available', '—'),
      updatedTotalEarnings: s('updated_total_earnings', '—'),
    );
  }

  String _formatCurrency(num value) {
    final rupees = value / 100;
    final rounded = rupees.round();
    return '₹$rounded';
  }
}

