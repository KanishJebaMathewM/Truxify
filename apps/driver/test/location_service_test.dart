import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:truxify_driver/services/battery_service.dart';
import 'package:truxify_driver/services/location_service.dart';
import 'package:truxify_shared/truxify_shared.dart';

import 'setup.dart';

/// A test double for [ResilientWebSocket] that provides controllable connection,
/// message interception, and simulated server push events.
class FakeResilientWebSocket extends ResilientWebSocket {
  FakeResilientWebSocket(
    String url, {
    void Function()? onConnect,
    String Function()? urlFactory,
  }) : super(url, onConnect: onConnect, urlFactory: urlFactory);

  final List<dynamic> sentMessages = [];
  final StreamController<dynamic> incomingController =
      StreamController<dynamic>.broadcast();
  bool _fakeConnected = false;
  bool closeCalled = false;
  WsSendResult sendResultOutcome = WsSendResult.delivered;

  @override
  bool get isConnected => _fakeConnected;

  @override
  Stream<dynamic> get stream => incomingController.stream;

  @override
  Future<void> connect() async {
    _fakeConnected = true;
    onConnect?.call();
  }

  @override
  bool send(dynamic message) {
    sentMessages.add(message);
    return true;
  }

  @override
  WsSendResult sendResult(dynamic message) {
    if (_fakeConnected && sendResultOutcome == WsSendResult.delivered) {
      sentMessages.add(message);
      return WsSendResult.delivered;
    }
    return WsSendResult.failed;
  }

  @override
  Future<void> close() async {
    _fakeConnected = false;
    closeCalled = true;
    if (!incomingController.isClosed) {
      await incomingController.close();
    }
  }

  void simulateMessage(dynamic message) {
    if (!incomingController.isClosed) {
      incomingController.add(message is String ? message : jsonEncode(message));
    }
  }

  void simulateError(Object error) {
    if (!incomingController.isClosed) {
      incomingController.addError(error);
    }
  }
}

Position _createPosition({
  double latitude = 19.0760,
  double longitude = 72.8777,
  double speed = 12.5,
  double heading = 180.0,
  DateTime? timestamp,
  bool isMocked = false,
}) {
  return Position(
    latitude: latitude,
    longitude: longitude,
    timestamp: timestamp ?? DateTime.now(),
    accuracy: 5.0,
    altitude: 10.0,
    altitudeAccuracy: 1.0,
    heading: heading,
    headingAccuracy: 1.0,
    speed: speed,
    speedAccuracy: 1.0,
    isMocked: isMocked,
  );
}

void main() {
  setUpAll(() async {
    await setupTests();
  });

  late LocationService service;
  FakeResilientWebSocket? fakeWs;

  setUp(() {
    service = LocationService.instance;
    service.stopTracking();
    LocationService.wsFactoryForTesting = (url, {onConnect, urlFactory}) {
      fakeWs = FakeResilientWebSocket(
        url,
        onConnect: onConnect,
        urlFactory: urlFactory,
      );
      return fakeWs!;
    };
  });

  tearDown(() {
    service.stopTracking();
    LocationService.wsFactoryForTesting = null;
    fakeWs = null;
  });

  group('Location Ping Construction and Payload Shape', () {
    test('builds valid location_ping envelope and contract fields', () {
      final position = _createPosition(
        latitude: 28.7041,
        longitude: 77.1025,
        speed: 22.4,
        heading: 45.0,
      );

      final payload = service.buildLocationPayload(
        position,
        driverId: 'driver-xyz',
        orderId: 'order-123',
        orderDisplayId: 'TRUX-9999',
      );

      expect(payload['event'], equals('location_ping'));
      final data = payload['data'] as Map<String, dynamic>;

      // Driver IDs
      expect(data['driver_id'], equals('driver-xyz'));
      expect(data['driverId'], equals('driver-xyz'));

      // Order IDs
      expect(data['order_display_id'], equals('TRUX-9999'));
      expect(data['orderId'], equals('order-123'));

      // Coordinates
      expect(data['latitude'], equals(28.7041));
      expect(data['longitude'], equals(77.1025));
      expect(data['lat'], equals(28.7041));
      expect(data['lng'], equals(77.1025));

      // Telemetry
      expect(data['speed'], equals(22.4));
      expect(data['bearing'], equals(45.0));

      // Timestamps
      expect(data['device_timestamp'], isA<String>());
      expect(data['timestamp'], isA<String>());
      expect(DateTime.tryParse(data['device_timestamp'] as String), isNotNull);
      expect(DateTime.tryParse(data['timestamp'] as String), isNotNull);

      // Battery info
      expect(data['battery_level'], isA<int>());
      expect(data['charging_status'], anyOf(equals('charging'), equals('discharging')));
    });

    test('preserves negative and zero coordinate values accurately', () {
      final position = _createPosition(
        latitude: -33.8688,
        longitude: -151.2093,
        speed: 0.0,
        heading: 0.0,
      );

      final payload = service.buildLocationPayload(
        position,
        driverId: 'drv-001',
        orderId: 'ord-001',
        orderDisplayId: 'DISP-001',
      );

      final data = payload['data'] as Map<String, dynamic>;
      expect(data['latitude'], equals(-33.8688));
      expect(data['longitude'], equals(-151.2093));
      expect(data['speed'], equals(0.0));
      expect(data['bearing'], equals(0.0));
    });
  });

  group('WebSocket Connect/Disconnect & Reconnect Handling', () {
    test('connectWebSocket creates ResilientWebSocket and sends initial auth frame', () async {
      final statusList = <WsConnectionStatus>[];
      final sub = service.connectionStatus.listen(statusList.add);

      await service.connectWebSocket();
      await pumpEventQueue();

      expect(fakeWs, isNotNull);
      expect(fakeWs!.isConnected, isTrue);
      expect(service.resilientWs, equals(fakeWs));
      expect(statusList, contains(WsConnectionStatus.connecting));
      expect(statusList, contains(WsConnectionStatus.connected));

      // Verify first-frame auth handshake was sent
      expect(fakeWs!.sentMessages, isNotEmpty);
      final authMsg = fakeWs!.sentMessages.first;
      expect(authMsg['event'], equals('auth'));
      expect(authMsg['data'], isNotNull);

      await sub.cancel();
    });

    test('wsAuthenticated remains false until server sends authenticated status', () async {
      await service.connectWebSocket();
      await pumpEventQueue();

      expect(service.wsAuthenticated, isFalse);

      // Simulate authenticated response from server
      fakeWs!.simulateMessage({'status': 'authenticated'});
      await pumpEventQueue();

      expect(service.wsAuthenticated, isTrue);
    });

    test('ignores pong messages without failing connection', () async {
      await service.connectWebSocket();
      await pumpEventQueue();

      expect(() => fakeWs!.simulateMessage('pong'), returnsNormally);
      await pumpEventQueue();

      expect(service.resilientWs, isNotNull);
      expect(service.lastCloseCode, isNull);
    });

    test('closeWebSocket closes socket and cleans up subscription', () async {
      await service.connectWebSocket();
      await pumpEventQueue();

      service.closeWebSocket();

      expect(fakeWs!.closeCalled, isTrue);
      expect(service.resilientWs, isNull);
    });
  });

  group('stopTracking Cleanup Behavior', () {
    test('resets all state, closes WebSocket, and emits disconnected status', () async {
      final statusList = <WsConnectionStatus>[];
      final sub = service.connectionStatus.listen(statusList.add);

      service.isTrackingForTesting = true;
      service.activeOrderId = 'order-test';
      service.activeOrderDisplayId = 'display-test';
      service.lastSentPosition = _createPosition();
      service.lastSentTime = DateTime.now();
      service.lastTriggeredMilestone = 'Arrived at Pickup';
      service.wsAuthenticated = true;

      await service.connectWebSocket();
      await pumpEventQueue();

      service.stopTracking();
      await pumpEventQueue();

      expect(service.isTracking, isFalse);
      expect(service.wsAuthenticated, isFalse);
      expect(service.activeOrderId, isNull);
      expect(service.activeOrderDisplayId, isNull);
      expect(service.lastSentPosition, isNull);
      expect(service.lastTriggeredMilestone, isNull);
      expect(service.resilientWs, isNull);
      expect(fakeWs!.closeCalled, isTrue);
      expect(statusList.last, equals(WsConnectionStatus.disconnected));

      await sub.cancel();
    });

    test('calling stopTracking when not tracking is a safe no-op', () {
      expect(service.isTracking, isFalse);
      expect(() => service.stopTracking(), returnsNormally);
      expect(() => service.stopTracking(), returnsNormally);
      expect(service.isTracking, isFalse);
    });
  });

  group('Error & Close-Code Handling', () {
    test('closes socket and stops tracking on 4001 auth rejection (numeric)', () async {
      service.isTrackingForTesting = true;
      await service.connectWebSocket();
      await pumpEventQueue();

      fakeWs!.simulateMessage({'code': 4001, 'reason': 'Invalid token'});
      await pumpEventQueue();

      expect(service.lastCloseCode, equals(4001));
      expect(service.isTracking, isFalse);
      expect(service.resilientWs, isNull);
      expect(fakeWs!.closeCalled, isTrue);
    });

    test('closes socket and stops tracking on 4003 auth rejection (string code)', () async {
      service.isTrackingForTesting = true;
      await service.connectWebSocket();
      await pumpEventQueue();

      fakeWs!.simulateMessage({'code': '4003', 'reason': 'Driver unassigned'});
      await pumpEventQueue();

      expect(service.lastCloseCode, equals(4003));
      expect(service.isTracking, isFalse);
      expect(service.resilientWs, isNull);
      expect(fakeWs!.closeCalled, isTrue);
    });

    test('does not stop tracking on standard non-auth close codes', () async {
      service.isTrackingForTesting = true;
      await service.connectWebSocket();
      await pumpEventQueue();

      fakeWs!.simulateMessage({'code': 1000, 'reason': 'Normal closure'});
      await pumpEventQueue();

      expect(service.lastCloseCode, equals(1000));
      expect(service.isTracking, isTrue);
    });

    test('cleans up resilientWs on WebSocket stream error without unhandled exception', () async {
      await service.connectWebSocket();
      await pumpEventQueue();

      fakeWs!.simulateError(Exception('Network connection reset'));
      await pumpEventQueue();

      expect(service.resilientWs, isNull);
    });

    test('handles malformed json messages gracefully', () async {
      await service.connectWebSocket();
      await pumpEventQueue();

      expect(() => fakeWs!.simulateMessage('invalid{json'), returnsNormally);
      await pumpEventQueue();

      expect(service.resilientWs, isNotNull);
    });
  });

  group('Location Filtering & Throttling Logic', () {
    test('drops stale GPS fix older than maxLocationAge (10s)', () async {
      service.isTrackingForTesting = true;
      final stalePosition = _createPosition(
        timestamp: DateTime.now().subtract(const Duration(seconds: 15)),
      );

      await service.handleLocationUpdate(stalePosition);
      expect(service.lastSentPosition, isNull);
    });

    test('drops mocked GPS fixes', () async {
      service.isTrackingForTesting = true;
      final mockedPosition = _createPosition(isMocked: true);

      await service.handleLocationUpdate(mockedPosition);
      expect(service.lastSentPosition, isNull);
    });

    test('throttles minor displacement (<10m) within max interval (<5s)', () async {
      service.isTrackingForTesting = true;
      service.activeOrderId = 'test-order';
      service.activeOrderDisplayId = 'TEST-01';
      service.wsAuthenticated = true;
      await service.connectWebSocket();
      await pumpEventQueue();

      final initialPos = _createPosition(latitude: 19.076000, longitude: 72.877700);
      await service.handleLocationUpdate(initialPos);
      expect(service.lastSentPosition, equals(initialPos));

      // Small movement ~1 meter
      final minorPos = _createPosition(latitude: 19.076010, longitude: 72.877700);
      await service.handleLocationUpdate(minorPos);

      // Should still be initial position because minor movement was throttled
      expect(service.lastSentPosition, equals(initialPos));
    });
  });
}
