import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify/core/api_client.dart';
import 'package:truxify/services/order_service.dart';
import 'package:truxify/services/supabase_service.dart';

class MockApiClient extends Mock implements ApiClient {}
class MockSupabaseClient extends Mock implements SupabaseClient {}
class MockGoTrueClient extends Mock implements GoTrueClient {}
class MockUser extends Mock implements User {}

void main() {
  late MockApiClient apiClient;
  late MockSupabaseClient supabaseClient;
  late MockGoTrueClient authClient;
  late MockUser user;
  late OrderService orderService;

  setUp(() {
    apiClient = MockApiClient();
    supabaseClient = MockSupabaseClient();
    authClient = MockGoTrueClient();
    user = MockUser();

    SupabaseService.mockClient = supabaseClient;

    when(() => supabaseClient.auth).thenReturn(authClient);
    when(() => authClient.currentUser).thenReturn(user);
    when(() => user.id).thenReturn('user_123');

    orderService = OrderService(apiClient: apiClient);
  });

  tearDown(() {
    SupabaseService.mockClient = null;
  });

  test('createOrder delegates post to ApiClient', () async {
    when(() => apiClient.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async => {'order': {'order_display_id': 'ORD-123'}});

    final orderId = await orderService.createOrder(
      pickupAddress: 'Pickup Loc',
      dropAddress: 'Drop Loc',
      pickupLat: 12.3,
      pickupLng: 45.6,
      dropLat: 78.9,
      dropLng: 12.3,
      pickupTime: '10:00 AM',
      goodsType: 'Timber',
      weightTonnes: 5.5,
    );

    expect(orderId, equals('ORD-123'));

    verify(
      () => apiClient.post(
        '/api/orders',
        body: any(named: 'body'),
      ),
    ).called(1);
  });

  test('fetchOrderById handles success and 404', () async {
    when(() => apiClient.get('/api/orders/ORD-123'))
        .thenAnswer((_) async => {'order': {'id': 'ORD-123', 'status': 'pending'}});

    final order = await orderService.fetchOrderById('ORD-123');
    expect(order?['id'], equals('ORD-123'));

    // 404 error case
    when(() => apiClient.get('/api/orders/ORD-404'))
        .thenThrow(const ApiException(404, 'Not Found'));
    final order404 = await orderService.fetchOrderById('ORD-404');
    expect(order404, isNull);
  });

  test('fetchOrders accepts wrapped and bare history lists', () async {
    when(() => apiClient.get('/api/orders/history'))
        .thenAnswer((_) async => {'history': [{'id': 'ORD-1'}]});

    expect(await orderService.fetchOrders(), [
      {'id': 'ORD-1'},
    ]);

    when(() => apiClient.get('/api/orders/history'))
        .thenAnswer((_) async => [{'id': 'ORD-2'}]);

    expect(await orderService.fetchHistoryOrders(), [
      {'id': 'ORD-2'},
    ]);
  });

  test('fetchOrders rejects malformed history payloads', () async {
    when(() => apiClient.get('/api/orders/history'))
        .thenAnswer((_) async => {'history': 'not-a-list'});

    await expectLater(
      orderService.fetchOrders,
      throwsA(
        isA<StateError>().having(
          (error) => error.message,
          'message',
          contains('Failed to fetch orders'),
        ),
      ),
    );
  });

  test('fetchTruckNumber encodes truck id path segment', () async {
    when(() => apiClient.get('/api/trucks/truck%2F123%23plate/number'))
        .thenAnswer((_) async => {'number_plate': 'MH-01-AB-1234'});

    final number = await orderService.fetchTruckNumber('truck/123#plate');

    expect(number, equals('MH-01-AB-1234'));
    verify(
      () => apiClient.get('/api/trucks/truck%2F123%23plate/number'),
    ).called(1);
  });

  test('searchTrucks rejects malformed response payloads', () async {
    when(() => apiClient.get(any(that: startsWith('/api/trucks/search'))))
        .thenAnswer((_) async => {'trucks': []});

    await expectLater(
      () => orderService.searchTrucks(
        pickupLat: 12.3,
        pickupLng: 45.6,
        dropLat: 78.9,
        dropLng: 12.3,
        weightTonnes: 5.5,
      ),
      throwsA(
        isA<StateError>().having(
          (error) => error.message,
          'message',
          contains('Failed to search trucks'),
        ),
      ),
    );
  });

  group('estimatePriceRange', () {
    test('returns correct min and max when prices are integers', () async {
      when(() => apiClient.get(
            any(that: startsWith('/api/trucks/search')),
          )).thenAnswer((_) async => [
            {'price': 5000},
            {'price': 8000},
            {'price': 6500},
          ]);

      final result = await orderService.estimatePriceRange(
        pickupLat: 12.3,
        pickupLng: 45.6,
        dropLat: 78.9,
        dropLng: 12.3,
        weightTonnes: 5.5,
      );

      expect(result, isNotNull);
      expect(result!['minPrice'], equals(5000));
      expect(result['maxPrice'], equals(8000));
    });

    test('returns correct rounded min and max when prices are doubles', () async {
      when(() => apiClient.get(
            any(that: startsWith('/api/trucks/search')),
          )).thenAnswer((_) async => [
            {'price': 5000.7},
            {'price': 8000.2},
            {'price': 6500.0},
          ]);

      final result = await orderService.estimatePriceRange(
        pickupLat: 12.3,
        pickupLng: 45.6,
        dropLat: 78.9,
        dropLng: 12.3,
        weightTonnes: 5.5,
      );

      expect(result, isNotNull);
      expect(result!['minPrice'], equals(5001)); // 5000.7 rounded
      expect(result['maxPrice'], equals(8000)); // 8000.2 rounded
    });

    test('returns null when search results are empty', () async {
      when(() => apiClient.get(
            any(that: startsWith('/api/trucks/search')),
          )).thenAnswer((_) async => []);

      final result = await orderService.estimatePriceRange(
        pickupLat: 12.3,
        pickupLng: 45.6,
        dropLat: 78.9,
        dropLng: 12.3,
        weightTonnes: 5.5,
      );

      expect(result, isNull);
    });

    test('returns null when api client throws exception', () async {
      when(() => apiClient.get(
            any(that: startsWith('/api/trucks/search')),
          )).thenThrow(const ApiException(500, 'Server Error'));

      final result = await orderService.estimatePriceRange(
        pickupLat: 12.3,
        pickupLng: 45.6,
        dropLat: 78.9,
        dropLng: 12.3,
        weightTonnes: 5.5,
      );

      expect(result, isNull);
    });
  });
}
