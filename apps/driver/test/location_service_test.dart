import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

// Adjust package imports to match your apps/driver/pubspec.yaml name
import 'package:driver/services/location_service.dart';
import 'package:driver/services/resilient_websocket.dart';

class MockResilientWebSocket extends Mock implements ResilientWebSocket {}

void main() {
  late MockResilientWebSocket mockSocket;
  late StreamController<dynamic> incomingMessagesController;
  late StreamController<WebSocketConnectionState> connectionStateController;
  late LocationService locationService;

  setUp(() {
    mockSocket = MockResilientWebSocket();
    incomingMessagesController = StreamController<dynamic>.broadcast();
    connectionStateController =
        StreamController<WebSocketConnectionState>.broadcast();

    // Stub default socket streams and methods
    when(() => mockSocket.messages)
        .thenAnswer((_) => incomingMessagesController.stream);
    when(() => mockSocket.connectionState)
        .thenAnswer((_) => connectionStateController.stream);
    when(() => mockSocket.isConnected).thenReturn(true);
    when(() => mockSocket.connect()).thenAnswer((_) async {});
    when(() => mockSocket.disconnect()).thenAnswer((_) async {});
    when(() => mockSocket.dispose()).thenAnswer((_) async {});
    when(() => mockSocket.send(any())).thenReturn(null);

    // Inject the mocked ResilientWebSocket into LocationService
    locationService = LocationService(
      webSocketFactory: ({required String url, Map<String, String>? headers}) =>
          mockSocket,
    );
  });

  tearDown(() async {
    await locationService.dispose();
    await incomingMessagesController.close();
    await connectionStateController.close();
  });

  group('Location Ping Construction & Payload Shape', () {
    test('constructs valid JSON telemetry ping with required coordinate fields',
        () async {
      await locationService.startTracking(
        driverId: 'drv_101',
        orderId: 'ord_505',
        token: 'valid_jwt_token',
      );

      final timestamp = DateTime.utc(2026, 11, 16, 12, 0, 0);

      await locationService.sendLocationPing(
        latitude: 18.5204,
        longitude: 73.8567,
        speed: 42.5,
        heading: 180.0,
        accuracy: 5.2,
        timestamp: timestamp,
      );

      final captured = verify(() => mockSocket.send(captureAny())).captured;
      expect(captured, hasLength(1));

      final payload = jsonDecode(captured.first as String) as Map<String, dynamic>;

      expect(payload['type'], equals('location_update'));
      expect(payload['driverId'], equals('drv_101'));
      expect(payload['orderId'], equals('ord_505'));
      expect(payload['latitude'], equals(18.5204));
      expect(payload['longitude'], equals(73.8567));
      expect(payload['speed'], equals(42.5));
      expect(payload['heading'], equals(180.0));
      expect(payload['accuracy'], equals(5.2));
      expect(payload['timestamp'], equals(timestamp.toIso8601String()));
    });

    test('omits or handles nullable orderId cleanly when driver is idle',
        () async {
      await locationService.startTracking(
        driverId: 'drv_101',
        token: 'valid_jwt_token',
      );

      await locationService.sendLocationPing(
        latitude: 18.5310,
        longitude: 73.8446,
      );

      final captured = verify(() => mockSocket.send(captureAny())).captured;
      final payload = jsonDecode(captured.first as String) as Map<String, dynamic>;

      expect(payload['driverId'], equals('drv_101'));
      expect(payload['orderId'], isNull);
      expect(payload['latitude'], equals(18.5310));
      expect(payload['longitude'], equals(73.8446));
    });
  });

  group('WebSocket Connect, Disconnect & Reconnect Handling', () {
    test('establishes socket connection when startTracking is called', () async {
      await locationService.startTracking(
        driverId: 'drv_101',
        token: 'valid_jwt_token',
      );

      verify(() => mockSocket.connect()).called(1);
      expect(locationService.isTracking, isTrue);
    });

    test('buffers or skips pings while disconnected and resumes on reconnect',
        () async {
      await locationService.startTracking(
        driverId: 'drv_101',
        token: 'valid_jwt_token',
      );

      // Simulate socket drop
      when(() => mockSocket.isConnected).thenReturn(false);
      connectionStateController.add(WebSocketConnectionState.reconnecting);
      await pumpEventQueue();

      await locationService.sendLocationPing(
        latitude: 18.5204,
        longitude: 73.8567,
      );

      // Simulate socket recovery
      when(() => mockSocket.isConnected).thenReturn(true);
      connectionStateController.add(WebSocketConnectionState.connected);
      await pumpEventQueue();

      await locationService.sendLocationPing(
        latitude: 18.5250,
        longitude: 73.8600,
      );

      verify(() => mockSocket.send(any())).called(greaterThanOrEqualTo(1));
    });

    test('does not open duplicate connections if startTracking is called twice',
        () async {
      await locationService.startTracking(
        driverId: 'drv_101',
        token: 'valid_jwt_token',
      );
      await locationService.startTracking(
        driverId: 'drv_101',
        token: 'valid_jwt_token',
      );

      verify(() => mockSocket.connect()).called(1);
    });
  });

  group('stopTracking Cleanup Behavior', () {
    test('disconnects socket, cancels timers/subscriptions, and resets state',
        () async {
      await locationService.startTracking(
        driverId: 'drv_101',
        orderId: 'ord_505',
        token: 'valid_jwt_token',
      );
      expect(locationService.isTracking, isTrue);

      await locationService.stopTracking();

      expect(locationService.isTracking, isFalse);
      verify(() => mockSocket.disconnect()).called(1);

      // Subsequent pings after stopTracking must not be sent over the wire
      await locationService.sendLocationPing(
        latitude: 18.5204,
        longitude: 73.8567,
      );
      verifyNever(() => mockSocket.send(any()));
    });
  });

  group('Error & Close-Code Handling (Auth Rejection)', () {
    test('stops tracking and surfaces auth error on 4001/4401 close code',
        () async {
      final errors = <Object>[];
      final errorSub = locationService.errorStream.listen(errors.add);

      await locationService.startTracking(
        driverId: 'drv_101',
        token: 'expired_or_invalid_token',
      );

      // Simulate server rejecting connection with custom auth close code (e.g. 4001 / 4401)
      when(() => mockSocket.lastCloseCode).thenReturn(4001);
      when(() => mockSocket.lastCloseReason).thenReturn('Unauthorized');
      connectionStateController.add(WebSocketConnectionState.disconnected);
      await pumpEventQueue();

      expect(locationService.isTracking, isFalse);
      expect(errors, isNotEmpty);
      verify(() => mockSocket.disconnect()).called(1);

      await errorSub.cancel();
    });

    test('handles server-sent JSON auth error frame gracefully', () async {
      final errors = <Object>[];
      final errorSub = locationService.errorStream.listen(errors.add);

      await locationService.startTracking(
        driverId: 'drv_101',
        token: 'revoked_token',
      );

      incomingMessagesController.add(
        jsonEncode({
          'type': 'error',
          'code': 'AUTH_REJECTED',
          'message': 'Invalid or expired driver token',
        }),
      );
      await pumpEventQueue();

      expect(locationService.isTracking, isFalse);
      expect(errors, isNotEmpty);

      await errorSub.cancel();
    });
  });
}