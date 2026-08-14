import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify/controllers/app_controller.dart';
import 'package:truxify/l10n/app_localizations.dart';
import 'package:truxify/screens/live_tracking_screen.dart';
import 'package:truxify/services/order_service.dart';
import 'package:truxify/services/tracking_service.dart';
import 'package:truxify/services/supabase_service.dart';
import 'package:truxify/core/offline/websocket/resilient_websocket.dart';

class MockOrderService extends Mock implements OrderService {}
class MockTrackingService extends Mock implements TrackingService {}
class MockResilientWebSocket extends Mock implements ResilientWebSocket {}
class MockSupabaseClient extends Mock implements SupabaseClient {}
class MockGoTrueClient extends Mock implements GoTrueClient {}
class MockUser extends Mock implements User {}

void main() {
  late MockOrderService mockOrderService;
  late MockTrackingService mockTrackingService;
  late MockResilientWebSocket mockSocket;
  late MockSupabaseClient mockSupabase;
  late MockGoTrueClient mockAuth;
  late MockUser mockUser;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    mockOrderService = MockOrderService();
    mockTrackingService = MockTrackingService();
    mockSocket = MockResilientWebSocket();
    mockSupabase = MockSupabaseClient();
    mockAuth = MockGoTrueClient();
    mockUser = MockUser();

    when(() => mockUser.id).thenReturn('mock-user-id');
    when(() => mockAuth.currentUser).thenReturn(mockUser);
    when(() => mockSupabase.auth).thenReturn(mockAuth);
    SupabaseService.mockClient = mockSupabase;

    // Stub WebSocket
    when(() => mockSocket.connect()).thenAnswer((_) async {});
    when(() => mockSocket.close()).thenAnswer((_) async {});
    when(() => mockSocket.stream).thenAnswer((_) => const Stream.empty());

    // Stub order service calls
    when(() => mockOrderService.fetchOrderById(any())).thenAnswer((_) async => {
      'id': 'order-123',
      'order_display_id': 'TX1001',
      'pickup_address': 'Surat, Gujarat',
      'drop_address': 'Mumbai, Maharashtra',
      'pickup_lat': 21.17,
      'pickup_lng': 72.83,
      'drop_lat': 19.07,
      'drop_lng': 72.87,
      'driver_id': 'driver-1',
      'driver_name': 'Suresh Kumar',
      'driver_phone': '9876543210',
      'truck_id': 'truck-1',
      'truck_number': 'GJ-05-XX-1234',
      'status': 'In Transit',
      'updated_at': '2026-08-03T00:00:00Z',
    });

    when(() => mockOrderService.fetchOrderTimeline(any())).thenAnswer((_) async => [
      {
        'status': 'Booked',
        'timestamp': '2026-08-03T00:00:00Z',
        'completed': true,
      }
    ]);

    when(() => mockOrderService.fetchOrderRoute(any())).thenAnswer((_) async => {
      'geometry': {
        'coordinates': [
          [72.83, 21.17],
          [72.87, 19.07]
        ]
      }
    });

    when(() => mockOrderService.fetchDriverLocation(any())).thenAnswer((_) async => {
      'lat': 20.0,
      'lng': 72.85,
    });

    when(() => mockOrderService.fetchDriverName(any())).thenAnswer((_) async => 'Suresh Kumar');
    when(() => mockOrderService.fetchTruckNumber(any())).thenAnswer((_) async => 'GJ-05-XX-1234');
    when(() => mockOrderService.fetchMlEta(
      tripId: any(named: 'tripId'),
      lat: any(named: 'lat'),
      lng: any(named: 'lng'),
    )).thenAnswer((_) async => {'eta_minutes': 45.0});
  });

  Widget createTestWidget(WidgetTester tester) {
    tester.view.physicalSize = const Size(800, 1200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    return TruxifyScope(
      controller: TruxifyController(),
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: LiveTrackingScreen(
            orderId: 'TX1001',
            orderService: mockOrderService,
            trackingService: mockTrackingService,
            trackingWebSocket: mockSocket,
          ),
        ),
      ),
    );
  }

  group('LiveTrackingScreen Widget Tests', () {
    testWidgets('mounts the map widget and initiates WebSocket connection on load', (tester) async {
      await tester.pumpWidget(createTestWidget(tester));
      await tester.pump(); // Start data loading
      await tester.pumpAndSettle(); // Wait for animations & state

      // Verify the map widget mounts without errors
      expect(find.byType(FlutterMap), findsOneWidget);

      // Verify WebSocket connection is initiated
      verify(() => mockSocket.connect()).called(1);
    });

    testWidgets('displays Calculating... on first load, then displays the formatted ML ETA', (tester) async {
      await tester.pumpWidget(createTestWidget(tester));
      expect(find.textContaining('Calculating…'), findsOneWidget);

      await tester.pump();
      await tester.pumpAndSettle();

      expect(find.textContaining('45 mins'), findsOneWidget);
    });
  });
}
