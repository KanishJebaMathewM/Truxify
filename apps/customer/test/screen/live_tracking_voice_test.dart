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

    when(() => mockSocket.connect()).thenAnswer((_) async {});
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

  Widget buildSubject() {
    return AnimatedBuilder(
      animation: AppController.instance,
      builder: (context, _) {
        return MaterialApp(
          locale: AppController.instance.locale,
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

  testWidgets('renders Voice AI button and opens modal sheet on tap', (tester) async {
    await tester.pumpWidget(buildSubject());
    await tester.pumpAndSettle();

    // Verify Voice AI action tile exists
    final voiceAiTile = find.text('Voice AI');
    expect(voiceAiTile, findsOneWidget);

    // Tap Voice AI tile
    await tester.tap(voiceAiTile);
    await tester.pumpAndSettle();

    // Verify Voice AI bottom sheet header
    expect(find.text('Truxify Voice AI Assistant'), findsOneWidget);
    expect(find.text('Frequent Queries'), findsOneWidget);
    expect(find.text('Where is my package?'), findsOneWidget);
  });

  testWidgets('sends voice query when preset chip is tapped and shows response card', (tester) async {
    await tester.pumpWidget(buildSubject());
    await tester.pumpAndSettle();

    // Open Voice AI sheet
    await tester.tap(find.text('Voice AI'));
    await tester.pumpAndSettle();

    // Tap preset query chip "Where is my package?"
    final chip = find.text('Where is my package?');
    expect(chip, findsOneWidget);
    await tester.tap(chip);
    await tester.pumpAndSettle();

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
