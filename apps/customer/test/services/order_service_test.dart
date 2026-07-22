import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify/core/api_client.dart';
import 'package:truxify/models/app_models.dart';
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

  test('fetchOrderTimeline accepts wrapped and bare timeline lists', () async {
    when(() => apiClient.get('/api/orders/ORD-123/timeline'))
        .thenAnswer((_) async => {'timeline': [{'title': 'Booked'}]});

    expect(await orderService.fetchOrderTimeline('ORD-123'), [
      {'title': 'Booked'},
    ]);

    when(() => apiClient.get('/api/orders/ORD-456/timeline'))
        .thenAnswer((_) async => [{'title': 'Assigned'}]);

    expect(await orderService.fetchOrderTimeline('ORD-456'), [
      {'title': 'Assigned'},
    ]);
  });

  test('fetchOrderTimeline rejects malformed timeline payloads', () async {
    when(() => apiClient.get('/api/orders/ORD-123/timeline'))
        .thenAnswer((_) async => {'timeline': 'not-a-list'});

    await expectLater(
      () => orderService.fetchOrderTimeline('ORD-123'),
      throwsA(
        isA<StateError>().having(
          (error) => error.message,
          'message',
          contains('Failed to fetch order timeline'),
        ),
      ),
    );
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

  test('searchTrucks forwards filter parameters as query string', () async {
    when(() => apiClient.get(any(that: startsWith('/api/trucks/search'))))
        .thenAnswer((_) async => []);

    await orderService.searchTrucks(
      pickupLat: 12.3,
      pickupLng: 45.6,
      dropLat: 78.9,
      dropLng: 12.3,
      weightTonnes: 5.5,
      truckType: 'Open Body',
      minCapacity: 5.0,
      maxCapacity: 15.0,
      materialType: 'Textile',
    );

    final captured = verify(
      () => apiClient.get(captureAny(that: startsWith('/api/trucks/search'))),
    ).captured.single as String;

    expect(captured, contains('truck_type=Open%20Body'));
    expect(captured, contains('min_capacity=5.0'));
    expect(captured, contains('max_capacity=15.0'));
    expect(captured, contains('material_type=Textile'));
  });

  test('searchTrucks omits filter params when null', () async {
    when(() => apiClient.get(any(that: startsWith('/api/trucks/search'))))
        .thenAnswer((_) async => []);

    await orderService.searchTrucks(
      pickupLat: 12.3,
      pickupLng: 45.6,
      dropLat: 78.9,
      dropLng: 12.3,
      weightTonnes: 5.5,
    );

    final captured = verify(
      () => apiClient.get(captureAny(that: startsWith('/api/trucks/search'))),
    ).captured.single as String;

    expect(captured, isNot(contains('truck_type')));
    expect(captured, isNot(contains('min_capacity')));
    expect(captured, isNot(contains('max_capacity')));
    expect(captured, isNot(contains('material_type')));
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

  group('RouteDraft filter fields', () {
    test('holds filter values when provided', () {
      const draft = RouteDraft(
        pickup: 'Mumbai',
        drop: 'Delhi',
        dateLabel: 'Tomorrow, 6:00 AM',
        goodsType: 'Textile',
        weightTonnes: '5',
        dimensions: '12 × 6 × 6',
        stacked: true,
        fragile: false,
        requirements: [],
        truckType: 'Open Body',
        minCapacity: 5.0,
        maxCapacity: 15.0,
        materialType: 'Textile',
      );

      expect(draft.truckType, equals('Open Body'));
      expect(draft.minCapacity, equals(5.0));
      expect(draft.maxCapacity, equals(15.0));
      expect(draft.materialType, equals('Textile'));
    });

    test('defaults filter fields to null when omitted', () {
      const draft = RouteDraft(
        pickup: 'Mumbai',
        drop: 'Delhi',
        dateLabel: 'Tomorrow, 6:00 AM',
        goodsType: 'Textile',
        weightTonnes: '5',
        dimensions: '12 × 6 × 6',
        stacked: true,
        fragile: false,
        requirements: [],
      );

      expect(draft.truckType, isNull);
      expect(draft.minCapacity, isNull);
      expect(draft.maxCapacity, isNull);
      expect(draft.materialType, isNull);
  group('submitRating', () {
    test('sends correct payload to POST /api/orders/:id/ratings', () async {
      when(() => apiClient.post(
            '/api/orders/ORD-100/ratings',
            body: any(named: 'body'),
          )).thenAnswer((_) async => {
            'message': 'Rating submitted successfully.',
            'rating': {
              'order_display_id': 'ORD-100',
              'customer_id': 'user_123',
              'driver_id': 'driver-abc',
              'stars': 5,
              'comment': 'Great delivery!',
            },
          });

      final result = await orderService.submitRating(
        orderId: 'ORD-100',
        stars: 5,
        comment: 'Great delivery!',
      );

      expect(result['message'], equals('Rating submitted successfully.'));
      expect(result['rating']['stars'], equals(5));

      verify(
        () => apiClient.post(
          '/api/orders/ORD-100/ratings',
          body: {'stars': 5, 'comment': 'Great delivery!'},
        ),
      ).called(1);
    });

    test('omits comment when null or empty', () async {
      when(() => apiClient.post(
            '/api/orders/ORD-200/ratings',
            body: any(named: 'body'),
          )).thenAnswer((_) async => {
            'message': 'Rating submitted successfully.',
            'rating': {'stars': 3},
          });

      await orderService.submitRating(orderId: 'ORD-200', stars: 3);

      verify(
        () => apiClient.post(
          '/api/orders/ORD-200/ratings',
          body: {'stars': 3},
        ),
      ).called(1);
    });

    test('throws StateError on ApiException', () async {
      when(() => apiClient.post(
            any(),
            body: any(named: 'body'),
          )).thenThrow(const ApiException(400, 'Order must be delivered'));

      await expectLater(
        () => orderService.submitRating(orderId: 'ORD-300', stars: 4),
        throwsA(
          isA<StateError>().having(
            (e) => e.message,
            'message',
            contains('Order must be delivered'),
          ),
        ),
      );
    });

    test('throws StateError on generic exception', () async {
      when(() => apiClient.post(
            any(),
            body: any(named: 'body'),
          )).thenThrow(Exception('network timeout'));

      await expectLater(
        () => orderService.submitRating(orderId: 'ORD-400', stars: 2),
        throwsA(
          isA<StateError>().having(
            (e) => e.message,
            'message',
            contains('Failed to submit rating'),
          ),
        ),
      );
    });

    test('encodes special characters in order ID', () async {
      when(() => apiClient.post(
            '/api/orders/ORD%2F123%23abc/ratings',
            body: any(named: 'body'),
          )).thenAnswer((_) async => {'message': 'ok'});

      await orderService.submitRating(orderId: 'ORD/123#abc', stars: 1);

      verify(
        () => apiClient.post(
          '/api/orders/ORD%2F123%23abc/ratings',
          body: {'stars': 1},
        ),
      ).called(1);
    });
  });
}
