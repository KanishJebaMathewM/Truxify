import 'package:flutter/material.dart';
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
import 'package:truxify_shared/truxify_shared.dart' show WsConnectionState;

class MockOrderService extends Mock implements OrderService {}
class MockTrackingService extends Mock implements TrackingService {}
class MockResilientWebSocket extends Mock implements ResilientWebSocket {}
class MockSupabaseClient extends Mock implements SupabaseClient {}
class MockGoTrueClient extends Mock implements GoTrueClient {}
class MockUser extends Mock implements User {}
class MockRealtimeChannel extends Mock implements RealtimeChannel {}

void main() {
  setUpAll(() {
    // mocktail needs fallbacks for the realtime channel matchers.
    registerFallbackValue(MockRealtimeChannel());
    registerFallbackValue(PostgresChangeEvent.update);
    registerFallbackValue(PostgresChangeFilter(
      type: PostgresChangeFilterType.eq,
      column: 'id',
      value: '',
    ));
  });

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
    // The screen subscribes to Supabase realtime channels — mocktail's
    // unstubbed channel() returns null (Null→RealtimeChannel type error).
    final mockRealtimeChannel = MockRealtimeChannel();
    when(() => mockRealtimeChannel.onBroadcast(
          event: any(named: 'event'),
          callback: any(named: 'callback'),
        )).thenReturn(mockRealtimeChannel);
    when(() => mockRealtimeChannel.onPostgresChanges(
          event: any(named: 'event'),
          schema: any(named: 'schema'),
          table: any(named: 'table'),
          filter: any(named: 'filter'),
          callback: any(named: 'callback'),
        )).thenReturn(mockRealtimeChannel);
    when(() => mockRealtimeChannel.subscribe(any())).thenReturn(mockRealtimeChannel);
    when(() => mockSupabase.channel(any())).thenReturn(mockRealtimeChannel);
    when(() => mockSupabase.removeChannel(any())).thenAnswer((_) async => '');
    when(() => mockSupabase.removeAllChannels()).thenAnswer((_) async => <String>[]);
    SupabaseService.mockClient = mockSupabase;

    when(() => mockSocket.connect()).thenAnswer((_) async {});
    // mocktail's unstubbed bool-returning send() returns null, which throws
    // a Null→bool type error inside the message handler.
    when(() => mockSocket.send(any())).thenReturn(true);
    // The screen subscribes to connectionState for reconnect detection.
    when(() => mockSocket.connectionState)
        .thenAnswer((_) => const Stream<WsConnectionState>.empty());
    when(() => mockSocket.close()).thenAnswer((_) async {});
    when(() => mockSocket.stream).thenAnswer((_) => const Stream.empty());

    when(() => mockOrderService.fetchOrderById(any())).thenAnswer((_) async => {
      'id': 'order-123',
      'order_display_id': 'TX1001',
      'pickup_address': 'Surat, Gujarat',
      'drop_address': 'Mumbai, Maharashtra',
      'driver_name': 'Suresh Kumar',
      'driver_phone': '+919876543210',
      'truck_number': 'MH04AB1234',
      'status': 'in_transit',
      'eta': '25 mins',
    });

    when(() => mockOrderService.fetchOrderTimeline(any())).thenAnswer((_) async => []);
    // The screen fetches the driver's initial location on load — mocktail's
    // unstubbed Future-returning members return null (Null→Future type error).
    when(() => mockOrderService.fetchDriverLocation(any())).thenAnswer(
      (_) async => {'lat': 20.0, 'lng': 72.85, 'timestamp': '2026-08-03T00:00:00Z'},
    );
    when(() => mockOrderService.fetchDriverName(any())).thenAnswer((_) async => 'Suresh Kumar');
    when(() => mockOrderService.fetchTruckNumber(any())).thenAnswer((_) async => 'GJ-05-XX-1234');
    when(() => mockOrderService.fetchOrderRoute(any())).thenAnswer((_) async => {
      'points': [
        {'lat': 21.17, 'lng': 72.83},
        {'lat': 19.07, 'lng': 72.87},
      ],
    });

    when(() => mockOrderService.fetchMlEta(
      tripId: any(named: 'tripId'),
      lat: any(named: 'lat'),
      lng: any(named: 'lng'),
    )).thenAnswer((_) async => {
      'eta_minutes': 45.0,
    });

    when(() => mockOrderService.sendVoiceQuery(
      bookingId: any(named: 'bookingId'),
      query: any(named: 'query'),
    )).thenAnswer((_) async => {
      'transcript': 'Where is my package?',
      'response_text': 'Your shipment (TX1001) is currently in transit near NH-48 Jaipur Highway.',
      'audio_url': '/api/voice/audio/test-audio-123',
      'intent': 'location',
    });
  });

  final controller = TruxifyController();

  Widget buildSubject() {
    // The action grid (Voice AI tile) sits below the fold at the default
    // 800x600 test surface — enlarge like the sibling suite so it's hittable.
    final testView = TestWidgetsFlutterBinding.instance.platformDispatcher.views.first;
    testView.physicalSize = const Size(800, 1200);
    testView.devicePixelRatio = 1.0;
    addTearDown(() {
      testView.resetPhysicalSize();
      testView.resetDevicePixelRatio();
    });
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        return MaterialApp(
          locale: controller.locale,
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: LiveTrackingScreen(
            orderId: 'TX1001',
            orderService: mockOrderService,
            trackingService: mockTrackingService,
            trackingWebSocket: mockSocket,
          ),
        );
      },
    );
  }


/// The screen's live indicator animates forever, so pumpAndSettle never
/// settles (see #17587). Bounded pumps flush async work + transitions.
Future<void> _boundedSettle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
  await tester.pump();
}

  testWidgets('renders Voice AI button and opens modal sheet on tap', (tester) async {
    await tester.pumpWidget(buildSubject());
    await _boundedSettle(tester);

    // Verify Voice AI action tile exists
    final voiceAiTile = find.text('Voice AI');
    expect(voiceAiTile, findsOneWidget);

    // The tile sits below the fold in the tracking panel — scroll to it
    // before tapping (a raw tap on an off-screen widget is a no-op).
    await tester.ensureVisible(voiceAiTile);
    await _boundedSettle(tester);
    await tester.tap(voiceAiTile);
    await _boundedSettle(tester);

    // Verify Voice AI bottom sheet header
    expect(find.text('Truxify Voice AI Assistant'), findsOneWidget);
    expect(find.text('Frequent Queries'), findsOneWidget);
    expect(find.text('Where is my package?'), findsOneWidget);
  });

  testWidgets('sends voice query when preset chip is tapped and shows response card', (tester) async {
    await tester.pumpWidget(buildSubject());
    await _boundedSettle(tester);

    // Open Voice AI sheet (scroll the tile into view first — off-screen
    // taps are no-ops).
    await tester.ensureVisible(find.text('Voice AI'));
    await _boundedSettle(tester);
    await tester.tap(find.text('Voice AI'));
    await _boundedSettle(tester);

    // Tap preset query chip "Where is my package?" (scroll within the
    // sheet if it's below the fold).
    final chip = find.text('Where is my package?');
    await tester.ensureVisible(chip);
    await _boundedSettle(tester);
    expect(chip, findsOneWidget);
    await tester.tap(chip);
    await _boundedSettle(tester);

    // Verify sendVoiceQuery was called
    verify(() => mockOrderService.sendVoiceQuery(
      bookingId: 'TX1001',
      query: 'Where is my package?',
    )).called(1);

    // Verify response card displayed
    expect(find.text('AI Response'), findsOneWidget);
    expect(find.text('LOCATION'), findsOneWidget);
    expect(find.text('Your shipment (TX1001) is currently in transit near NH-48 Jaipur Highway.'), findsOneWidget);
    expect(find.text('Audio ready (ElevenLabs TTS)'), findsOneWidget);
  });
}
