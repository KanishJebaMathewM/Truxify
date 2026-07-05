import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/app_models.dart';
import '../models/marketplace_models.dart';

class MarketplaceRepository {
  MarketplaceRepository({
    SupabaseClient? client,
    http.Client? httpClient,
    String? apiBaseUrl,
  })  : _providedClient = client,
        _httpClient = httpClient ?? http.Client(),
        _apiBaseUrl = (apiBaseUrl ?? defaultApiBaseUrl).replaceFirst(
          RegExp(r'/$'),
          '',
        );

  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  final SupabaseClient? _providedClient;
  SupabaseClient get _client => _providedClient ?? Supabase.instance.client;
  final http.Client _httpClient;
  final String _apiBaseUrl;

  Future<Map<String, String>> _authHeaders() async {
    final accessToken = await FirebaseAuth.instance.currentUser?.getIdToken();
    final userId = _client.auth.currentUser?.id ?? '';
    return <String, String>{
      'Content-Type': 'application/json',
      if (accessToken != null) 'Authorization': 'Bearer $accessToken',
    };
  }

  Future<List<LoadOffer>> fetchLoadOffers() async {
    final uri = Uri.parse('$_apiBaseUrl/api/orders/load-offers');
    final response = await _httpClient.get(uri, headers: await _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch load offers');
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! List) throw StateError('Unexpected response type');
    return decoded.cast<Map<String, dynamic>>().map(_mapLoadOffer).toList(growable: false);
  }

  Future<List<LoadOffer>> fetchEnRouteLoads() async {
    final uri = Uri.parse('$_apiBaseUrl/api/orders/load-offers/en-route');
    final response = await _httpClient.get(uri, headers: await _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch en-route loads');
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! List) throw StateError('Unexpected response type');
    return decoded.cast<Map<String, dynamic>>().map(_mapLoadOffer).toList(growable: false);
  }

  Future<DriverBid> submitBid({
    required String loadId,
    required String driverId,
    required num amount,
  }) async {
    final uri = Uri.parse('$_apiBaseUrl/api/orders/$loadId/bids');
    final accessToken = await FirebaseAuth.instance.currentUser?.getIdToken();
    final response = await _httpClient.post(
      uri,
      headers: <String, String>{
        'Content-Type': 'application/json',
        if (accessToken != null) 'Authorization': 'Bearer $accessToken',
      },
      body: jsonEncode(<String, dynamic>{
        'bid_amount': (amount * 100).round(),
      }),
    );

    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(decoded['error']?.toString() ?? 'Failed to submit bid.');
    }

    return DriverBid.fromJson(Map<String, dynamic>.from(decoded['bid'] as Map));
  }

  Future<List<DriverBid>> fetchDriverBids({required String driverId}) async {
    final uri = Uri.parse('$_apiBaseUrl/api/driver/bids');
    final response = await _httpClient.get(uri, headers: await _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch driver bids');
    }

    final decoded = jsonDecode(response.body);
    final body = decoded is Map<String, dynamic>
        ? decoded['bids'] as List? ?? const []
        : decoded as List;
    return body.cast<Map<String, dynamic>>().map(DriverBid.fromJson).toList(growable: false);
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

  /// Subscribes to new available load offers via Supabase Realtime postgres_changes.
  /// Returns a stream of [LoadOffer] objects as they are inserted.
  /// Callers should cancel the [StreamSubscription] when done.
  Stream<LoadOffer> subscribeToNewLoads() {
    final controller = StreamController<LoadOffer>.broadcast();
    RealtimeChannel? channel;

    try {
      final client = _client;
      channel = client.channel('new_load_offers');
      channel.onPostgresChanges(
        event: PostgresChangeEvent.insert,
        schema: 'public',
        table: 'load_offers',
        filter: PostgresChangeFilter(
          type: PostgresChangeFilterType.eq,
          column: 'status',
          value: 'available',
        ),
        callback: (payload) {
          try {
            final newRecord = payload.newRecord;
            if (newRecord.isNotEmpty) {
              final offer = _mapLoadOffer(newRecord);
              controller.add(offer);
            }
          } catch (e, st) {
            developer.log('Error mapping load offer', error: e, stackTrace: st);
          }
        },
      ).subscribe();
    } catch (e, st) {
      developer.log('Supabase/Realtime not available', error: e, stackTrace: st);
    }

    controller.onCancel = () {
      if (channel != null) {
        try {
          _client.removeChannel(channel);
        } catch (e, st) {
          developer.log('Error removing channel', error: e, stackTrace: st);
        }
      }
      controller.close();
    };

    return controller.stream;
  }

  String _formatCurrency(num value) {
    final rupees = value / 100;
    final rounded = rupees.round();
    return '₹$rounded';
  }
}
