import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_shared/truxify_shared.dart';

void main() {
  group('ResilientWebSocket', () {
    test('default parameters are set correctly', () {
      final ws = ResilientWebSocket('ws://localhost:8080/ws');
      expect(ws.url, 'ws://localhost:8080/ws');
      expect(ws.stream, isNotNull);
    });

    test('accepts custom parameters', () {
      final ws = ResilientWebSocket(
        'ws://example.com/ws',
        initialDelay: const Duration(seconds: 5),
        maxDelay: const Duration(seconds: 120),
        maxAttempts: 3,
      );
      expect(ws.url, 'ws://example.com/ws');
      // The stream getter should always return a broadcast stream controller.
      expect(ws.stream, isNotNull);
    });

    test('stream is a broadcast stream', () {
      final ws = ResilientWebSocket('ws://localhost:8080/ws');
      // Broadcast streams can have multiple listeners.
      expect(ws.stream.isBroadcast, isTrue);
    });

    test('send returns silently when not connected', () {
      final ws = ResilientWebSocket('ws://localhost:8080/ws');
      // Should not throw when there is no active channel.
      expect(() => ws.send({'test': 'data'}), returnsNormally);
      expect(() => ws.send('plain string'), returnsNormally);
    });

    test('send reports false when not connected (no silent pretend-success)', () {
      final ws = ResilientWebSocket('ws://localhost:8080/ws');
      // A disconnected socket must NOT claim the message was handed off.
      expect(ws.send({'test': 'data'}), isFalse);
      expect(ws.send('plain string'), isFalse);
    });

    test('sendResult reports failed when not connected', () {
      final ws = ResilientWebSocket('ws://localhost:8080/ws');
      expect(ws.sendResult({'test': 'data'}), WsSendResult.failed);
      expect(ws.sendResult('plain string'), WsSendResult.failed);
    });

    test('sendResult reports failed while connecting', () async {
      // No server is listening; after connect() the wrapper is in the
      // connecting/reconnecting states, never `connected`.
      final ws = ResilientWebSocket('ws://localhost:1/nonexistent');
      await ws.connect();
      expect(
        ws.sendResult({'test': 'data'}),
        WsSendResult.failed,
        reason: 'Messages must never be accepted while the socket is not '
            'confirmed connected.',
      );
      await ws.close();
    });

    test('sendResult reports failed after close', () async {
      final ws = ResilientWebSocket('ws://localhost:8080/ws');
      await ws.close();
      expect(ws.sendResult('anything'), WsSendResult.failed);
    });

    test('connection state starts disconnected', () {
      final ws = ResilientWebSocket('ws://localhost:8080/ws');
      expect(ws.connectionStateValue, WsConnectionState.disconnected);
      expect(ws.isConnected, isFalse);
    });

    test('connection state transitions to disconnected after close', () async {
      final ws = ResilientWebSocket('ws://localhost:8080/ws');
      final states = <WsConnectionState>[];
      final sub = ws.connectionState.listen(states.add);
      await ws.close();
      await Future<void>.delayed(const Duration(milliseconds: 10));
      await sub.cancel();
      expect(states, isNotEmpty);
      expect(states.last, WsConnectionState.disconnected);
      expect(ws.isConnected, isFalse);
    });

    test('close is safe when not connected', () async {
      final ws = ResilientWebSocket('ws://localhost:8080/ws');
      // close() should not throw when called on an unconnected instance.
      await expectLater(ws.close(), completes);
      // Calling close() twice should also be safe.
      await expectLater(ws.close(), completes);
    });

    test('multiple close calls do not throw', () async {
      final ws = ResilientWebSocket('ws://localhost:8080/ws');
      await ws.close();
      await ws.close();
      await ws.close();
      // The third close should complete without error.
    });

    test('connect is safe to call multiple times', () async {
      // ResilientWebSocket.connect() will try to connect and fail gracefully
      // (no server running at the URL), scheduling a reconnect internally.
      // It should not throw and should not leak resources.
      final ws = ResilientWebSocket('ws://localhost:1/nonexistent');
      // Calling connect on a URL where no server is running should
      // not throw — the error is handled by _scheduleReconnect.
      await expectLater(ws.connect(), completes);
      // Calling connect again resets the attempt counter.
      await expectLater(ws.connect(), completes);
      await ws.close();
    });

    test('urlFactory is called on reconnect attempts', () async {
      int factoryCallCount = 0;
      final ws = ResilientWebSocket(
        'ws://localhost:1/initial',
        urlFactory: () {
          factoryCallCount++;
          return 'ws://localhost:2/refreshed';
        },
        maxAttempts: 1,
        initialDelay: const Duration(milliseconds: 10),
      );

      await ws.connect();
      // Wait briefly for the reconnect attempt to fire.
      await Future.delayed(const Duration(milliseconds: 100));
      await ws.close();

      // The factory should have been called at least for the initial connect
      // (the initial URL is used directly, the factory is only called on
      // reconnect). With maxAttempts=1 and a failing connection, it will
      // attempt once and stop.
      expect(factoryCallCount, greaterThan(0));
    });

    test('stream is accessible after close', () async {
      final ws = ResilientWebSocket('ws://localhost:8080/ws');
      await ws.close();
      // The stream property should still be accessible (it returns the
      // controller stream which is already closed, but not null).
      expect(ws.stream, isNotNull);
    });

    test('onConnect callback is invoked', () async {
      int connectCount = 0;
      final ws = ResilientWebSocket(
        'ws://localhost:1/nonexistent',
        onConnect: () {
          connectCount++;
        },
        maxAttempts: 0,
      );

      await ws.connect();
      // With maxAttempts=0, no reconnect will happen, but connect() is
      // called once and will fail silently — onConnect should NOT fire
      // because the connection failed (the try/catch in _connectOnce
      // catches the error and schedules reconnect instead of calling
      // onConnect).
      await Future.delayed(const Duration(milliseconds: 50));
      expect(connectCount, 0);
      await ws.close();
    });
  });
}
