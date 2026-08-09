import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify/controllers/app_controller.dart';
import 'package:truxify/l10n/app_localizations.dart';
import 'package:truxify/models/app_models.dart';
import 'package:truxify/screens/orders_screen.dart';
import 'package:truxify/screens/order_detail_screen.dart';
import 'package:truxify/screens/live_tracking_screen.dart';
import 'package:truxify/services/order_service.dart';
import 'package:truxify/services/supabase_service.dart';
import 'package:truxify/widgets/order_card.dart';

class MockOrderService extends Mock implements OrderService {}
class MockSupabaseClient extends Mock implements SupabaseClient {}
class MockGoTrueClient extends Mock implements GoTrueClient {}
class MockUser extends Mock implements User {}

void main() {
  late MockOrderService mockOrderService;
  late MockSupabaseClient mockSupabase;
  late MockGoTrueClient mockAuth;
  late MockUser mockUser;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    mockOrderService = MockOrderService();
    mockSupabase = MockSupabaseClient();
    mockAuth = MockGoTrueClient();
    mockUser = MockUser();

    when(() => mockUser.id).thenReturn('mock-user-id');
    when(() => mockAuth.currentUser).thenReturn(mockUser);
    when(() => mockSupabase.auth).thenReturn(mockAuth);

    SupabaseService.mockClient = mockSupabase;

    // Stub active orders: order-1 has a normal driver name, order-2 has a UUID driver name
    when(() => mockOrderService.fetchActiveOrders()).thenAnswer((_) async => [
      {
        'id': 'order-1',
        'order_display_id': 'TX1001',
        'pickup_address': 'Surat, Gujarat',
        'drop_address': 'Mumbai, Maharashtra',
        'driver_name': 'Jane Smith',
        'truck_number': 'GJ-05-XX-1234',
        'status': 'In Transit',
        'eta': '2h 15m',
      },
      {
        'id': 'order-2',
        'order_display_id': 'TX1002',
        'pickup_address': 'Delhi, NCR',
        'drop_address': 'Jaipur, Rajasthan',
        'driver_name': 'd1f930e4-5c9b-439d-b8d4-9d54b568779b', // UUID
        'truck_number': 'DL-01-YY-5678',
        'status': 'Assigned',
        'eta': '4h 00m',
      }
    ]);

    // Stub history orders
    when(() => mockOrderService.fetchHistoryOrders()).thenAnswer((_) async => [
      {
        'id': 'order-3',
        'order_display_id': 'TX1003',
        'pickup_address': 'Kolkata, WB',
        'drop_address': 'Patna, Bihar',
        'pickup_date': '2024-06-15',
        'total_amount': 250000, // Rs 2500
        'status': 'Completed',
        'driver_name': 'Rajesh Kumar',
        'truck_number': 'WB-02-ZZ-9012',
      }
    ]);
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
          body: OrdersScreen(orderService: mockOrderService),
        ),
      ),
    );
  }

  group('OrdersScreen Widget Tests', () {
    testWidgets('renders active orders correctly and filters driver UUID', (tester) async {
      await tester.pumpWidget(createTestWidget(tester));
      await tester.pump(); // Start load
      await tester.pump(); // Build with loaded data

      // Verify active orders render
      expect(find.byType(ActiveOrderCard), findsNWidgets(2));
      expect(find.text('TX1001'), findsOneWidget);
      expect(find.text('TX1002'), findsOneWidget);

      // Verify driver name displays correctly for normal name
      expect(find.text('Jane Smith'), findsOneWidget);

      // Verify driver name filters out UUID and falls back to "Driver Assigned"
      expect(find.text('d1f930e4-5c9b-439d-b8d4-9d54b568779b'), findsNothing);
      expect(find.text('Driver Assigned'), findsOneWidget);
    });

    testWidgets('renders history orders correctly', (tester) async {
      await tester.pumpWidget(createTestWidget(tester));
      await tester.pump();
      await tester.pump();

      // Switch to history tab (index 1)
      final TabController tabController = tester.widget<TabBarView>(find.byType(TabBarView)).controller!;
      tabController.index = 1;
      await tester.pumpAndSettle();

      // Verify history order renders
      expect(find.byType(HistoryOrderCard), findsOneWidget);
      expect(find.text('TX1003'), findsOneWidget);
      expect(find.text('Rajesh Kumar'), findsOneWidget);
    });

    testWidgets('tapping an active order navigates to LiveTrackingScreen', (tester) async {
      await tester.pumpWidget(createTestWidget(tester));
      await tester.pump();
      await tester.pump();

      // Tap the first active order
      await tester.tap(find.byType(ActiveOrderCard).first);
      await tester.pumpAndSettle();

      // Verify navigated to LiveTrackingScreen
      expect(find.byType(LiveTrackingScreen), findsOneWidget);
      expect(find.byType(OrdersScreen), findsNothing);
    });

    testWidgets('tapping a history order navigates to OrderDetailScreen', (tester) async {
      await tester.pumpWidget(createTestWidget(tester));
      await tester.pump();
      await tester.pump();

      // Switch to history tab
      final TabController tabController = tester.widget<TabBarView>(find.byType(TabBarView)).controller!;
      tabController.index = 1;
      await tester.pumpAndSettle();

      // Tap the history order card
      await tester.tap(find.byType(HistoryOrderCard));
      await tester.pumpAndSettle();

      // Verify navigated to OrderDetailScreen
      expect(find.byType(OrderDetailScreen), findsOneWidget);
      expect(find.byType(OrdersScreen), findsNothing);
    });
  });
}
