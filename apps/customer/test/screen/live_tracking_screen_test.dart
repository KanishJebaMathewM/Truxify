import 'dart:async';
import 'dart:convert';

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
class MockRealtimeChannel extends Mock implements RealtimeChannel {}

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
        'milestone': 'Booking Confirmed',
        'milestone_time': '2026-08-03T00:00:00Z',
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

    testWidgets('displays formatted milestone timestamp using milestone_time', (tester) async {
      await tester.pumpWidget(createTestWidget(tester));
      await tester.pump();
      await tester.pumpAndSettle();

      final dt = DateTime.parse('2026-08-03T00:00:00Z').toLocal();
      final expectedTimestamp =
          '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}/${dt.year} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';

      expect(find.text(expectedTimestamp), findsWidgets);
    });

    testWidgets('refreshes authoritative state after reconnect', (tester) async {
      final messages = StreamController<dynamic>.broadcast();
      addTearDown(messages.close);
      when(() => mockSocket.stream).thenAnswer((_) => messages.stream);

      var orderFetches = 0;
      var timelineFetches = 0;
      var locationFetches = 0;
      when(() => mockOrderService.fetchOrderById(any())).thenAnswer((_) async {
        orderFetches++;
        return {
          'id': 'order-123',
          'order_display_id': 'TX1001',
          'status': orderFetches == 1 ? 'In Transit' : 'Delivered',
          'updated_at': orderFetches == 1
              ? '2026-08-03T00:00:00Z'
              : '2026-08-03T01:00:00Z',
        };
      });
      when(() => mockOrderService.fetchOrderTimeline(any())).thenAnswer((_) async {
        timelineFetches++;
        return [
          {
            'milestone': timelineFetches == 1 ? 'In Transit' : 'Delivered',
            'completed': true,
          },
        ];
      });
      when(() => mockOrderService.fetchDriverLocation(any())).thenAnswer((_) async {
        locationFetches++;
        return {
          'lat': locationFetches == 1 ? 20.0 : 21.0,
          'lng': 72.85,
          'timestamp': locationFetches == 1
              ? '2026-08-03T00:00:00Z'
              : '2026-08-03T01:00:00Z',
        };
      });

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      messages.add(jsonEncode({'status': 'authenticated'}));
      await tester.pump();
      messages.add(jsonEncode({'status': 'authenticated'}));
      await tester.pumpAndSettle();
      messages.add(jsonEncode({'status': 'authenticated'}));
      await tester.pumpAndSettle();

      expect(orderFetches, 2);
      expect(timelineFetches, 2);
      expect(locationFetches, 2);
      expect(find.text('Delivered'), findsWidgets);
    });

    testWidgets('keeps a newer live location over an older reconnect snapshot', (tester) async {
      final messages = StreamController<dynamic>.broadcast();
      addTearDown(messages.close);
      when(() => mockSocket.stream).thenAnswer((_) => messages.stream);

      final reconnectLocation = Completer<Map<String, dynamic>>();
      var locationFetches = 0;
      when(() => mockOrderService.fetchDriverLocation(any())).thenAnswer((_) {
        locationFetches++;
        if (locationFetches == 1) {
          return Future.value({
            'lat': 20.0,
            'lng': 72.85,
            'timestamp': '2026-08-03T00:00:00Z',
          });
        }
        return reconnectLocation.future;
      });

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pumpAndSettle();

      messages.add(jsonEncode({'status': 'authenticated'}));
      await tester.pump();
      messages.add(jsonEncode({'status': 'authenticated'}));
      await tester.pump();
      messages.add(jsonEncode({
        'event': 'location_update',
        'data': {
          'latitude': 22.0,
          'longitude': 72.85,
          'timestamp': '2026-08-03T02:00:00Z',
        },
      }));
      await tester.pump();

      reconnectLocation.complete({
        'lat': 21.0,
        'lng': 72.85,
        'timestamp': '2026-08-03T01:00:00Z',
      });
      await tester.pumpAndSettle();

      verify(() => mockOrderService.fetchMlEta(
            tripId: 'TX1001',
            lat: 22.0,
            lng: 72.85,
          )).called(1);
      verifyNever(() => mockOrderService.fetchMlEta(
            tripId: 'TX1001',
            lat: 21.0,
            lng: 72.85,
          ));
    });
  });

  group('LiveTrackingScreen realtime subscription regression (#12175)', () {
    testWidgets('subscribes to Supabase Realtime when order id is an integer', (tester) async {
      final mockChannel = MockRealtimeChannel();

      when(() => mockSupabase.removeChannel(any())).thenAnswer((_) async {});
      when(() => mockChannel.onBroadcast(
            event: any(named: 'event'),
            callback: any(named: 'callback'),
          )).thenReturn(mockChannel);
      when(() => mockChannel.onPostgresChanges(
            event: any(named: 'event'),
            schema: any(named: 'schema'),
            table: any(named: 'table'),
            filter: any(named: 'filter'),
            callback: any(named: 'callback'),
          )).thenReturn(mockChannel);
      when(() => mockChannel.subscribe()).thenReturn(mockChannel);
      when(() => mockChannel.subscribe(any())).thenReturn(mockChannel);

      final channelNames = <String>[];
      when(() => mockSupabase.channel(any())).thenAnswer((invocation) {
        channelNames.add(invocation.positionalArguments.first as String);
        return mockChannel;
      });

      when(() => mockOrderService.fetchOrderById(any())).thenAnswer((_) async => {
        'id': 123,
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

      await tester.pumpWidget(createTestWidget(tester));
      await tester.pump();
      await tester.pumpAndSettle();

      // The numeric order id must be coerced to a string and the realtime
      // subscription channel must be created. With `as String` this would
      // throw (swallowing the subscription); the fix uses toString().
      expect(channelNames, contains('driver-location:123'));
    });
  });
}
