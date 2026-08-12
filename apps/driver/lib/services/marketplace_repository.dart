import 'dart:async';
import 'dart:developer' as developer;

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/app_models.dart';
import '../models/deadhead_recommendation.dart';
import '../models/marketplace_models.dart';
import 'api_client.dart';
import 'driver_insights_service.dart';
import 'secure_storage.dart';

class MarketplaceRepository {
  MarketplaceRepository({
    SupabaseClient? client,
    ApiClient? apiClient,
    String? apiBaseUrl,
  })  : _providedClient = client,
        _apiClient = apiClient ?? ApiClient(baseUrl: apiBaseUrl),
        _apiBaseUrl = (apiBaseUrl ?? defaultApiBaseUrl).replaceFirst(
          RegExp(r'/$'),
          '',
        );

  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
  );

  final SupabaseClient? _providedClient;
  SupabaseClient get _client => _providedClient ?? Supabase.instance.client;
  final ApiClient _apiClient;
  final String _apiBaseUrl;

  String _encodePathSegment(String value) => Uri.encodeComponent(value);

  void dispose() {
    _apiClient.dispose();
  }

  Future<String?> _firebaseAccessToken() async {
    try {
      return await FirebaseAuth.instance.currentUser?.getIdToken();
    } catch (e) {
      debugPrint('Firebase token error: $e');
      return null;
    }
  }

  String? _supabaseAccessToken() {
    try {
      return _client.auth.currentSession?.accessToken;
    } catch (e) {
      debugPrint('Supabase token error: $e');
      return null;
    }
  }

  Future<Map<String, String>> _authHeaders() async {
    final token = _supabaseAccessToken() ?? await _firebaseAccessToken();
    if (token != null && token.isNotEmpty) {
      // Persist to OS-backed secure storage for background sync and
      // WebSocket reconnects (issue #5739).
      unawaited(AuthTokenStore.persist(token));
    }
    return <String, String>{
      'Content-Type': 'application/json',
      if (token != null && token.isNotEmpty)
        'Authorization': 'Bearer $token',
    };
  }

  Future<List<LoadOffer>> fetchLoadOffers() async {
    final path = '/api/orders/load-offers';
    try {
      final decoded = await _apiClient.get(path);
      if (decoded is! List) throw StateError('Unexpected response type');
      return decoded.cast<Map<String, dynamic>>().map(_mapLoadOffer).toList(growable: false);
    } catch (e) {
      if (e is ApiException) throw StateError(e.message);
      rethrow;
    }
  }

  Future<List<LoadOffer>> fetchEnRouteLoads({
    double? currentLat,
    double? currentLng,
    double maxDetourKm = 50,
  }) async {
    final queryParams = <String, String>{};
    if (currentLat != null && currentLng != null) {
      queryParams['current_lat'] = currentLat.toStringAsFixed(6);
      queryParams['current_lng'] = currentLng.toStringAsFixed(6);
      queryParams['max_detour_km'] = maxDetourKm.toStringAsFixed(1);
    }
    final query = queryParams.isNotEmpty
        ? '?${queryParams.entries.map((e) => '${e.key}=${e.value}').join('&')}'
        : '';
    final path = '/api/orders/load-offers/en-route$query';
    try {
      final decoded = await _apiClient.get(path);
      if (decoded is! List) throw StateError('Unexpected response type');
      return decoded.cast<Map<String, dynamic>>().map(_mapLoadOffer).toList(growable: false);
    } catch (e) {
      if (e is ApiException) throw StateError(e.message);
      rethrow;
    }
  }

  Future<Map<String, dynamic>> fetchDemandHeatmap() async {
    final path = '/api/demand-heatmap';
    try {
      final decoded = await _apiClient.get(path);
      return decoded as Map<String, dynamic>;
    } catch (e) {
      if (e is ApiException) throw StateError(e.message);
      rethrow;
    }
  }

  Future<DriverBid> submitBid({
    required String loadId,
    required num amount,
  }) async {
    final path = '/api/orders/${_encodePathSegment(loadId)}/bids';
    try {
      final decoded = await _apiClient.post(
        path,
        body: <String, dynamic>{
          'bid_amount': (amount * 100).round(),
        },
      ) as Map<String, dynamic>;
      
      return DriverBid.fromJson(Map<String, dynamic>.from(decoded['bid'] as Map));
    } catch (e) {
      if (e is ApiException) throw StateError(e.message);
      rethrow;
    }
  }

  Future<List<DriverBid>> fetchDriverBids() async {
    final path = '/api/driver/bids';
    try {
      final decoded = await _apiClient.get(path);
      final body = decoded is Map<String, dynamic>
          ? decoded['bids'] as List? ?? const []
          : decoded as List;
      return body.cast<Map<String, dynamic>>().map(DriverBid.fromJson).toList(growable: false);
    } catch (e) {
      if (e is ApiException) throw StateError(e.message);
      rethrow;
    }
  }

  Future<List<DeadheadRecommendation>> fetchDeadheadRecommendations({
    required double destLat,
    required double destLng,
    required double maxWeightKg,
    required double maxLengthM,
    required double maxWidthM,
    required double maxHeightM,
    required String arrivalTime,
    required List<Map<String, dynamic>> availableLoads,
  }) async {
    final path = '/api/driver/match/deadhead';
    try {
      final decoded = await _apiClient.post(
        path,
        body: <String, dynamic>{
          'driver_destination': {'lat': destLat, 'lng': destLng},
          'truck_specs': {
            'max_weight_kg': maxWeightKg,
            'max_length_m': maxLengthM,
            'max_width_m': maxWidthM,
            'max_height_m': maxHeightM,
          },
          'arrival_time': arrivalTime,
          'available_loads': availableLoads,
        },
      ) as Map<String, dynamic>;

      final recs = decoded['recommendations'] as List? ?? const [];
      return recs
          .cast<Map<String, dynamic>>()
          .map(DeadheadRecommendation.fromJson)
          .toList(growable: false);
    } catch (e) {
      if (e is ApiException) throw StateError(e.message);
      rethrow;
    }
  }

  /// Converts a raw `load_offers` row into the numeric fields the ML deadhead
  /// engine expects, normalising the database's storage format:
  ///   * `pickup_lat`/`pickup_lng`/`drop_lat`/`drop_lng` → `origin_*`/`dest_*`
  ///   * free-text `weight` ("3 tonnes") → `weightKg`
  ///   * free-text `dimensions` ("12 × 6 × 6 ft") → `lengthM`/`widthM`/`heightM`
  ///   * paisa `freight_value` → `paymentInr` (rupees)
  /// Legacy `origin_*`/`weight_kg`/`length_m`/`payment_inr` keys are still
  /// honoured when present (older API / mock responses). Exposed for tests.
  @visibleForTesting
  static ({
    double? originLat,
    double? originLng,
    double? destLat,
    double? destLng,
    double? weightKg,
    double? lengthM,
    double? widthM,
    double? heightM,
    double? paymentInr,
  }) rawDeadheadFields(Map<String, dynamic> row) {
    double? asDouble(String key) {
      final v = row[key];
      if (v is num) return v.toDouble();
      if (v is String) return double.tryParse(v);
      return null;
    }

    final dims = _parseDimensionsM((row['dimensions'] ?? '').toString());
    final freightValuePaisa = _numOr(row, 'freight_value', 0);
    return (
      originLat: asDouble('pickup_lat') ?? asDouble('origin_lat'),
      originLng: asDouble('pickup_lng') ?? asDouble('origin_lng'),
      destLat: asDouble('drop_lat') ?? asDouble('dest_lat'),
      destLng: asDouble('drop_lng') ?? asDouble('dest_lng'),
      weightKg: _parseWeightKg((row['weight'] ?? '').toString()) ??
          asDouble('weight_kg'),
      lengthM: dims != null ? dims[0] : asDouble('length_m'),
      widthM: dims != null ? dims[1] : asDouble('width_m'),
      heightM: dims != null ? dims[2] : asDouble('height_m'),
      paymentInr: freightValuePaisa > 0
          ? freightValuePaisa / 100
          : asDouble('payment_inr'),
    );
  }

  static num _numOr(Map<String, dynamic> row, String key, num fallback) {
    final v = row[key];
    if (v is num) return v;
    if (v is String) return num.tryParse(v) ?? fallback;
    return fallback;
  }

  /// Parses free-text weight like "3 tonnes" / "500 kg" into kilograms.
  /// Returns null when the unit cannot be interpreted.
  static double? _parseWeightKg(String weightText) {
    final text = weightText.trim().toLowerCase();
    if (text.isEmpty) return null;
    final match = RegExp(r'(\d+(?:\.\d+)?)\s*([a-z]*)').firstMatch(text);
    if (match == null) return null;
    final number = double.tryParse(match.group(1)!);
    if (number == null) return null;
    final unit = match.group(2) ?? '';
    if (unit.isEmpty || unit.startsWith('kg')) return number;
    if (unit.startsWith('ton')) return number * 1000;
    if (unit.startsWith('g')) return number / 1000;
    if (unit.startsWith('q')) return number * 100;
    return null;
  }

  /// Parses free-text dimensions like "12 × 6 × 6 ft" (or "4 × 2 × 2" in
  /// metres) into [lengthM, widthM, heightM]. Returns null unless three
  /// numeric values are present.
  static List<double>? _parseDimensionsM(String dimensionsText) {
    final numbers = RegExp(r'\d+(?:\.\d+)?')
        .allMatches(dimensionsText)
        .map((m) => double.tryParse(m.group(0)!))
        .whereType<double>()
        .take(3)
        .toList(growable: false);
    if (numbers.length != 3) return null;
    final text = dimensionsText.toLowerCase();
    final isFeet =
        text.contains('ft') || text.contains('feet') || text.contains("'");
    final factor = isFeet ? 0.3048 : 1.0;
    return numbers.map((n) => n * factor).toList(growable: false);
  }

  LoadOffer _mapLoadOffer(Map<String, dynamic> row) {
    String s(String key, [String fallback = '']) => (row[key] ?? fallback).toString();
    num n(String key, [num fallback = 0]) {
      final v = row[key];
      if (v is num) return v;
      if (v is String) return num.tryParse(v) ?? fallback;
      return fallback;
    }
    double d(String key, [double fallback = 0]) {
      final v = row[key];
      if (v is num) return v.toDouble();
      if (v is String) return double.tryParse(v) ?? fallback;
      return fallback;
    }
    int i(String key, [int fallback = 0]) {
      final v = row[key];
      if (v is num) return v.toInt();
      if (v is String) return int.tryParse(v) ?? fallback;
      return fallback;
    }
    bool b(String key, [bool fallback = false]) {
      final v = row[key];
      if (v is bool) return v;
      if (v is String) {
        final lower = v.toLowerCase();
        if (lower == 'true' || lower == '1') return true;
        if (lower == 'false' || lower == '0') return false;
      }
      if (v is num) return v != 0;
      return fallback;
    }

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

    // Raw numeric data for ML payloads (nullable for backward compatibility).
    // Real `load_offers` rows store coordinates under `pickup_*`/`drop_*`,
    // cargo weight/dimensions as free text and freight in paisa — those are
    // normalised here (see [rawDeadheadFields]). Legacy `origin_*` keys are
    // still honoured for older API responses.
    final raw = rawDeadheadFields(row);
    final originLat = raw.originLat;
    final originLng = raw.originLng;
    final destLat = raw.destLat;
    final destLng = raw.destLng;
    final weightKg = raw.weightKg;
    final lengthM = raw.lengthM;
    final widthM = raw.widthM;
    final heightM = raw.heightM;
    final paymentInr = raw.paymentInr;

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
      weight: weightKg != null ? '${_formatWeight(weightKg)} kg' : s('weight', '—'),
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
      originLat: originLat,
      originLng: originLng,
      destinationLat: destLat,
      destinationLng: destLng,
      weightKg: weightKg,
      lengthM: lengthM,
      widthM: widthM,
      heightM: heightM,
      paymentInr: paymentInr,
    );
  }

  /// Builds the deadhead recommendation payload matching the ML engine's
  /// [DeadheadInput] schema.  Loads with incomplete coordinate/cargo data are
  /// silently filtered out so the ML model never receives 0.0 placeholders.
  ///
  /// [loads] – available load offers (from [fetchLoadOffers] /
  ///           [fetchEnRouteLoads]).
  /// [driverLat], [driverLng] – the driver's current GPS coordinates.
  /// [truckMaxWeightKg] … [truckMaxHeightM] – truck capacity limits.
  /// [arrivalTime] – ISO-8601 datetime string for when the driver arrives
  ///                  at their destination.
  Map<String, dynamic> buildDeadheadPayload({
    required List<LoadOffer> loads,
    required double driverLat,
    required double driverLng,
    required double truckMaxWeightKg,
    required double truckMaxLengthM,
    required double truckMaxWidthM,
    required double truckMaxHeightM,
    required String arrivalTime,
  }) {
    final validLoads = <Map<String, dynamic>>[];
    for (final load in loads) {
      if (!load.hasDeadheadData) continue;
      validLoads.add(<String, dynamic>{
        'load_id': load.id,
        'origin_lat': load.originLat,
        'origin_lng': load.originLng,
        'dest_lat': load.destinationLat,
        'dest_lng': load.destinationLng,
        'weight_kg': load.weightKg,
        'length_m': load.lengthM ?? 1.0,
        'width_m': load.widthM ?? 1.0,
        'height_m': load.heightM ?? 1.0,
        'pickup_deadline': arrivalTime,
        'payment_inr': load.paymentInr,
      });
    }

    return <String, dynamic>{
      'driver_destination': <String, dynamic>{
        'lat': driverLat,
        'lng': driverLng,
      },
      'truck_specs': <String, dynamic>{
        'max_weight_kg': truckMaxWeightKg,
        'max_length_m': truckMaxLengthM,
        'max_width_m': truckMaxWidthM,
        'max_height_m': truckMaxHeightM,
      },
      'arrival_time': arrivalTime,
      'available_loads': validLoads,
    };
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
              if (!controller.isClosed) {
                controller.add(offer);
              }
            }
          } catch (e, st) {
            developer.log('Error mapping load offer', error: e, stackTrace: st);
          }
        },
      ).subscribe();
    } catch (e, st) {
      developer.log('Supabase/Realtime not available', error: e, stackTrace: st);
      controller.close();
      return const Stream.empty();
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

  Future<ProfitPrediction> predictLoadProfit({
    required LoadOffer load,
    required double truckMileageKmL,
    required double fuelPricePerLitre,
    required double tripDurationHours,
  }) async {
    final routeDistanceKm = _parseDistanceKm(load.routeDistance);
    final tollEstimateInr = _parseCurrencyInr(load.tollCost);
    final cargoWeightKg = load.weightKg ?? 0;

    if (routeDistanceKm <= 0 || cargoWeightKg <= 0 || truckMileageKmL <= 0) {
      throw StateError('Insufficient data for profit prediction');
    }

    final service = DriverInsightsService(apiBaseUrl: _apiBaseUrl);
    try {
      return await service.predictProfit(
        routeDistanceKm: routeDistanceKm,
        fuelPricePerLitre: fuelPricePerLitre,
        tollEstimateInr: tollEstimateInr,
        truckMileageKmL: truckMileageKmL,
        cargoWeightKg: cargoWeightKg,
        tripDurationHours: tripDurationHours,
      );
    } finally {
      service.dispose();
    }
  }

  double _parseDistanceKm(String distance) {
    final cleaned = distance.replaceAll(RegExp(r'[^0-9.]'), '');
    return double.tryParse(cleaned) ?? 0;
  }

  double _parseCurrencyInr(String value) {
    final cleaned = value.replaceAll(RegExp(r'[^0-9]'), '');
    return double.tryParse(cleaned) ?? 0;
  }

  String _formatCurrency(num value) {
    final rupees = value / 100;
    final rounded = rupees.round();
    return '₹$rounded';
  }

  String _formatWeight(double kg) {
    if (kg == kg.roundToDouble()) return '${kg.toInt()}';
    return kg.toStringAsFixed(1);
  }
}
