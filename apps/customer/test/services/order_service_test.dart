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
    when(() => user.userMetadata).thenReturn({'full_name': 'John Doe'});

    orderService = OrderService(apiClient: apiClient);
  });

  tearDown(() {
    SupabaseService.mockClient = null;
  });

  test('createOrder delegates post to ApiClient', () async {
    when(() => apiClient.post(any(), body: any(named: 'body'), headers: any(named: 'headers')))
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

    final captured = verify(
      () => apiClient.post(
        '/api/orders',
        headers: captureAny(named: 'headers'),
        body: any(named: 'body'),
      ),
    ).captured;
    final headers = captured.first as Map<String, String>;
    expect(headers['x-user-id'], equals('user_123'));
    expect(headers['x-user-role'], equals('customer'));
    expect(headers['x-user-name'], equals('John Doe'));
  });

  test('fetchOrderById handles success and 404', () async {
    when(() => apiClient.get('/api/orders/ORD-123', headers: any(named: 'headers')))
        .thenAnswer((_) async => {'order': {'id': 'ORD-123', 'status': 'pending'}});

    final order = await orderService.fetchOrderById('ORD-123');
    expect(order?['id'], equals('ORD-123'));

    // 404 error case
    when(() => apiClient.get('/api/orders/ORD-404', headers: any(named: 'headers')))
        .thenThrow(const ApiException(404, 'Not Found'));
    final order404 = await orderService.fetchOrderById('ORD-404');
    expect(order404, isNull);
  });
}
