import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:truxify_driver/services/api_client.dart';
import 'package:truxify_driver/services/marketplace_repository.dart';

MarketplaceRepository _repository(MockClient client) => MarketplaceRepository(
      apiClient: ApiClient(
        httpClient: client,
        baseUrl: 'http://localhost:5000',
      ),
    );

const _loadOfferRow = <String, dynamic>{
  'id': 'load-1',
  'route': 'Mumbai → Pune',
  'customer_name': 'Acme Corp',
  'company_name': 'Acme Logistics',
  'goods_type': 'Electronics',
  'pickup_address': 'Mumbai Central',
  'freight_value': 1470000,
  'net_profit': 850000,
};

void main() {
  group('MarketplaceRepository.fetchLoadOffers', () {
    test('returns parsed LoadOffer list on success', () async {
      final client = MockClient((request) async {
        expect(request.url.path, '/api/orders/load-offers');
        return http.Response(jsonEncode([_loadOfferRow]), 200);
      });

      final offers = await _repository(client).fetchLoadOffers();

      expect(offers, hasLength(1));
      expect(offers.first.id, 'load-1');
      expect(offers.first.route, 'Mumbai → Pune');
      expect(offers.first.customer, 'Acme Corp');
      expect(offers.first.company, 'Acme Logistics');
      expect(offers.first.goods, 'Electronics');
      expect(offers.first.pickup, 'Mumbai Central');
      expect(offers.first.freightValue, '₹14700');
      expect(offers.first.netProfit, '₹8500');
    });

    test('returns empty list on empty response', () async {
      final client = MockClient((request) async {
        return http.Response('[]', 200);
      });

      final offers = await _repository(client).fetchLoadOffers();

      expect(offers, isEmpty);
    });

    test('throws StateError on non-list response', () async {
      final client = MockClient((request) async {
        return http.Response('{"not": "a list"}', 200);
      });

      expect(
        () => _repository(client).fetchLoadOffers(),
        throwsA(isA<StateError>()),
      );
    });

    test('wraps ApiException into StateError with message', () async {
      final client = MockClient((request) async {
        return http.Response('Server error', 500);
      });

      expect(
        () => _repository(client).fetchLoadOffers(),
        throwsA(isA<StateError>().having((e) => e.message, 'message', isNotEmpty)),
      );
    });
  });

  group('MarketplaceRepository.fetchEnRouteLoads', () {
    test('builds expected query params when coordinates provided', () async {
      final client = MockClient((request) async {
        expect(request.url.path, '/api/orders/load-offers/en-route');
        expect(request.url.queryParameters['current_lat'], '19.076090');
        expect(request.url.queryParameters['current_lng'], '72.877426');
        expect(request.url.queryParameters['max_detour_km'], '50.0');
        return http.Response('[]', 200);
      });

      final loads = await _repository(client).fetchEnRouteLoads(
        currentLat: 19.07609,
        currentLng: 72.877426,
      );

      expect(loads, isEmpty);
    });

    test('omits query params when coordinates are null', () async {
      final client = MockClient((request) async {
        expect(request.url.path, '/api/orders/load-offers/en-route');
        expect(request.url.query, isEmpty);
        return http.Response('[]', 200);
      });

      final loads = await _repository(client).fetchEnRouteLoads();

      expect(loads, isEmpty);
    });

    test('uses provided maxDetourKm', () async {
      final client = MockClient((request) async {
        expect(request.url.queryParameters['max_detour_km'], '120.0');
        return http.Response('[]', 200);
      });

      await _repository(client).fetchEnRouteLoads(
        currentLat: 19.0,
        currentLng: 72.0,
        maxDetourKm: 120,
      );
    });
  });

  group('MarketplaceRepository.submitBid', () {
    test('posts paisa-converted bid amount and parses response', () async {
      final client = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/api/orders/load-1/bids');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['bid_amount'], 150000);
        return http.Response(
          jsonEncode({
            'bid': {
              'id': 'bid-1',
              'load_id': 'load-1',
              'driver_id': 'driver-1',
              'bid_amount': 150000,
              'status': 'pending',
            },
          }),
          200,
        );
      });

      final bid = await _repository(client).submitBid(loadId: 'load-1', amount: 1500);

      expect(bid.id, 'bid-1');
      expect(bid.loadId, 'load-1');
      expect(bid.driverId, 'driver-1');
      expect(bid.amount, 1500);
      expect(bid.status.name, 'pending');
    });

    test('wraps ApiException into StateError', () async {
      final client = MockClient((request) async {
        return http.Response('Bad request', 400);
      });

      expect(
        () => _repository(client).submitBid(loadId: 'load-1', amount: 100),
        throwsA(isA<StateError>()),
      );
    });
  });

  group('MarketplaceRepository.rawDeadheadFields', () {
    test('normalises coordinates, weight text, dimensions and paisa freight', () {
      final fields = MarketplaceRepository.rawDeadheadFields({
        'pickup_lat': '19.07609',
        'pickup_lng': '72.877426',
        'drop_lat': '18.5204',
        'drop_lng': '73.8567',
        'weight': '3 tonnes',
        'dimensions': '12 × 6 × 6 ft',
        'freight_value': 150000,
      });

      expect(fields.originLat, closeTo(19.07609, 0.000001));
      expect(fields.originLng, closeTo(72.877426, 0.000001));
      expect(fields.destLat, closeTo(18.5204, 0.000001));
      expect(fields.destLng, closeTo(73.8567, 0.000001));
      expect(fields.weightKg, 3000);
      expect(fields.lengthM, closeTo(12 * 0.3048, 0.0001));
      expect(fields.widthM, closeTo(6 * 0.3048, 0.0001));
      expect(fields.heightM, closeTo(6 * 0.3048, 0.0001));
      expect(fields.paymentInr, 1500);
    });

    test('honours legacy keys when present', () {
      final fields = MarketplaceRepository.rawDeadheadFields({
        'origin_lat': 19.0,
        'origin_lng': 72.0,
        'dest_lat': 18.0,
        'dest_lng': 73.0,
        'weight_kg': 2500,
        'length_m': 5.0,
        'width_m': 2.5,
        'height_m': 2.5,
        'payment_inr': 12000,
      });

      expect(fields.originLat, 19.0);
      expect(fields.weightKg, 2500);
      expect(fields.lengthM, 5.0);
      expect(fields.paymentInr, 12000);
    });

    test('returns nulls for unrecognisable payloads', () {
      final fields = MarketplaceRepository.rawDeadheadFields({});

      expect(fields.originLat, isNull);
      expect(fields.originLng, isNull);
      expect(fields.destLat, isNull);
      expect(fields.destLng, isNull);
      expect(fields.weightKg, isNull);
      expect(fields.lengthM, isNull);
      expect(fields.paymentInr, isNull);
    });
  });
}
