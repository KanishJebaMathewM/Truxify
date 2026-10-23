import 'dart:async';
import 'dart:io';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stream_channel/stream_channel.dart';
import 'package:truxify_shared/truxify_shared.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

class ControlledSink implements WebSocketSink {
  final messages = <dynamic>[];
  final completed = Completer<void>();
  Completer<void>? closeGate;
  bool failWrites = false;
  int closes = 0;

  @override
  void add(dynamic data) {
    if (failWrites) throw StateError('transport write failed');
    messages.add(data);
  }

  @override
  void addError(Object error, [StackTrace? stackTrace]) {}

  @override
  Future<void> addStream(Stream<dynamic> stream) async {
    await for (final value in stream) {
      add(value);
    }
  }

  @override
  Future<void> close([int? closeCode, String? closeReason]) {
    closes++;
    if (!completed.isCompleted) completed.complete();
    return closeGate?.future ?? completed.future;
  }

  @override
  Future<void> get done => completed.future;
}

class ControlledChannel extends StreamChannelMixin<dynamic>
    implements WebSocketChannel {
  final incoming = StreamController<dynamic>(sync: true);
  final handshake = Completer<void>();
  final output = ControlledSink();

  @override
  Stream<dynamic> get stream => incoming.stream;
  @override
  WebSocketSink get sink => output;
  @override
  Future<void> get ready => handshake.future;
  @override
  String? get protocol => null;
  @override
  int? get closeCode => null;
  @override
  String? get closeReason => null;
}

Future<void> turn() => Future<void>.delayed(Duration.zero);

void main() {
  test(
    'late ready cannot revive a closed connection or invoke onConnect',
    () async {
      final channel = ControlledChannel();
      var callbacks = 0;
      final ws = ResilientWebSocket(
        'ws://unused',
        channelFactory: (_) => channel,
        onConnect: () => callbacks++,
      );
      final connecting = ws.connect();
      await turn();
      await ws.close();
      await connecting;
      channel.handshake.complete();
      await turn();
      expect(callbacks, 0);
      expect(ws.isConnected, false);
      expect(ws.connectionStateValue, WsConnectionState.disconnected);
      expect(channel.output.closes, 1);
    },
  );

  test(
    'close cancels a pending connect without waiting for handshake',
    () async {
      final channel = ControlledChannel();
      channel.output.closeGate = Completer<void>();
      final ws = ResilientWebSocket(
        'ws://unused',
        cleanupTimeout: const Duration(milliseconds: 10),
        channelFactory: (_) => channel,
      );
      final connecting = ws.connect();
      await turn();
      await ws.close().timeout(const Duration(seconds: 1));
      await connecting.timeout(const Duration(seconds: 1));
      channel.output.closeGate!.complete();
      channel.handshake.completeError(StateError('late ready failure'));
      await turn();
      expect(ws.isConnected, false);
    },
  );

  test(
    'permanent close rejects connection and sends without reopening',
    () async {
      var created = 0;
      final ws = ResilientWebSocket(
        'ws://unused',
        channelFactory: (_) {
          created++;
          return ControlledChannel();
        },
      );
      await ws.close();
      expect(ws.send('after close'), false);
      expect(ws.sendResult({'event': 'after close'}), WsSendResult.failed);
      await ws.connect();
      await ws.reconnect();
      await ws.close();
      expect(created, 0);
      expect(ws.isConnected, false);
    },
  );

  test(
    'replacement owns callbacks and messages despite an old late ready',
    () async {
      final channels = [ControlledChannel(), ControlledChannel()];
      var created = 0;
      var callbacks = 0;
      final ws = ResilientWebSocket(
        'ws://unused',
        channelFactory: (_) => channels[created++],
        onConnect: () => callbacks++,
      );
      final old = ws.connect();
      await turn();
      final current = ws.connect();
      await turn();
      channels[1].handshake.complete();
      await current;
      channels[0].handshake.complete();
      await old;
      expect(callbacks, 1);
      expect(ws.send('current'), true);
      expect(channels[0].output.messages, isEmpty);
      expect(channels[1].output.messages, ['current']);
      expect(channels[0].output.closes, 1);
      await ws.close();
    },
  );

  test(
    'old delayed cleanup does not erase the replacement transport',
    () async {
      final channels = [ControlledChannel(), ControlledChannel()];
      channels[0].output.closeGate = Completer<void>();
      var created = 0;
      final replacementCreated = Completer<void>();
      final ws = ResilientWebSocket(
        'ws://unused',
        cleanupTimeout: const Duration(milliseconds: 10),
        channelFactory: (_) {
          final channel = channels[created++];
          if (created == 2) replacementCreated.complete();
          return channel;
        },
      );
      final old = ws.connect();
      await turn();
      final current = ws.connect();
      await replacementCreated.future.timeout(const Duration(seconds: 1));
      channels[1].handshake.complete();
      await current;
      channels[0].output.closeGate!.complete();
      channels[0].handshake.complete();
      await old;
      await turn();
      expect(ws.send('still current'), true);
      expect(channels[1].output.messages, ['still current']);
      await ws.close();
    },
  );

  test('remote close before ready cannot publish connected', () async {
    final channel = ControlledChannel();
    final ws = ResilientWebSocket(
      'ws://unused',
      maxAttempts: 0,
      channelFactory: (_) => channel,
    );
    final connecting = ws.connect();
    await turn();
    await channel.incoming.close();
    await connecting;
    channel.handshake.complete();
    await turn();
    expect(ws.connectionStateValue, WsConnectionState.failed);
    expect(ws.isConnected, false);
    await ws.close();
  });

  test('terminal failure remains recoverable before permanent close', () async {
    final channels = [ControlledChannel(), ControlledChannel()];
    var created = 0;
    final ws = ResilientWebSocket(
      'ws://unused',
      maxAttempts: 0,
      channelFactory: (_) => channels[created++],
    );
    final first = ws.connect();
    await turn();
    channels[0].handshake.completeError(StateError('failed upgrade'));
    await first;
    expect(ws.connectionStateValue, WsConnectionState.failed);
    expect(ws.lastError.toString(), contains('Max reconnect attempts'));
    final recovered = ws.reconnect();
    await turn();
    channels[1].handshake.complete();
    await recovered;
    expect(ws.isConnected, true);
    expect(ws.lastError, null);
    await ws.close();
  });

  test('cancelled handshake and heartbeat leave no live wrapper timers', () {
    fakeAsync((clock) {
      final channel = ControlledChannel();
      var callbacks = 0;
      final ws = ResilientWebSocket(
        'ws://unused',
        channelFactory: (_) => channel,
        onConnect: () => callbacks++,
      );
      ws.connect();
      clock.flushMicrotasks();
      ws.close();
      clock.flushMicrotasks();
      channel.handshake.complete();
      clock.flushMicrotasks();
      clock.elapse(const Duration(seconds: 45));
      expect(callbacks, 0);
      expect(channel.output.messages, isEmpty);
      expect(clock.pendingTimers, isEmpty);
    });
  });

  test('only active transport receives heartbeat and close cancels it', () {
    fakeAsync((clock) {
      final channel = ControlledChannel();
      final ws = ResilientWebSocket(
        'ws://unused',
        channelFactory: (_) => channel,
      );
      ws.connect();
      clock.flushMicrotasks();
      channel.handshake.complete();
      clock.flushMicrotasks();
      clock.elapse(const Duration(seconds: 15));
      expect(channel.output.messages, ['ping']);
      ws.close();
      clock.flushMicrotasks();
      clock.elapse(const Duration(seconds: 45));
      expect(channel.output.messages, ['ping']);
      expect(clock.pendingTimers, isEmpty);
    });
  });

  test(
    'write failure leaves connected state and replays FIFO after reconnect',
    () async {
      final channels = [ControlledChannel(), ControlledChannel()];
      final reconnecting = Completer<void>();
      var created = 0;
      final ws = ResilientWebSocket(
        'ws://unused',
        initialDelay: Duration.zero,
        channelFactory: (_) {
          final channel = channels[created++];
          if (created == 2) reconnecting.complete();
          return channel;
        },
      );
      expect(ws.send('queued first'), false);
      final first = ws.connect();
      await turn();
      channels[0].handshake.complete();
      await first;
      expect(channels[0].output.messages, ['queued first']);
      channels[0].output.failWrites = true;
      expect(ws.send('retry second'), false);
      expect(ws.isConnected, false);
      expect(ws.send('queued third'), false);
      await reconnecting.future.timeout(const Duration(seconds: 1));
      channels[1].handshake.complete();
      await turn();
      expect(channels[1].output.messages, ['retry second', 'queued third']);
      await ws.close();
    },
  );

  test(
    'handshake timeout fences its later success and emits terminal failure',
    () {
      fakeAsync((clock) {
        final channel = ControlledChannel();
        var callbacks = 0;
        final ws = ResilientWebSocket(
          'ws://unused',
          maxAttempts: 0,
          handshakeTimeout: const Duration(seconds: 2),
          channelFactory: (_) => channel,
          onConnect: () => callbacks++,
        );
        ws.connect();
        clock.flushMicrotasks();
        clock.elapse(const Duration(seconds: 2));
        clock.flushMicrotasks();
        expect(ws.connectionStateValue, WsConnectionState.failed);
        channel.handshake.complete();
        clock.flushMicrotasks();
        expect(callbacks, 0);
        expect(ws.isConnected, false);
        ws.close();
        clock.flushMicrotasks();
        expect(clock.pendingTimers, isEmpty);
      });
    },
  );

  test(
    'shutdown inside transport factory cannot adopt its returned channel',
    () async {
      final channel = ControlledChannel();
      late ResilientWebSocket ws;
      ws = ResilientWebSocket(
        'ws://unused',
        channelFactory: (_) {
          ws.close();
          return channel;
        },
      );
      await ws.connect();
      channel.handshake.completeError(StateError('discarded transport'));
      await turn();
      expect(ws.isConnected, false);
      expect(channel.output.closes, 1);
      await ws.close();
    },
  );

  test('shutdown inside onConnect prevents replay and cancels heartbeat', () {
    fakeAsync((clock) {
      final channel = ControlledChannel();
      late ResilientWebSocket ws;
      ws = ResilientWebSocket(
        'ws://unused',
        channelFactory: (_) => channel,
        onConnect: () {
          ws.close();
        },
      );
      ws.send('must not replay after close');
      ws.connect();
      clock.flushMicrotasks();
      channel.handshake.complete();
      clock.flushMicrotasks();
      clock.elapse(const Duration(seconds: 45));
      expect(channel.output.messages, isEmpty);
      expect(ws.isConnected, false);
      expect(clock.pendingTimers, isEmpty);
    });
  });

  test(
    'paused caller subscription does not hold transport shutdown hostage',
    () async {
      final channel = ControlledChannel();
      final ws = ResilientWebSocket(
        'ws://unused',
        channelFactory: (_) => channel,
      );
      final subscription = ws.stream.listen((_) {});
      subscription.pause();
      final connecting = ws.connect();
      await turn();
      channel.handshake.complete();
      await connecting;
      await ws.close().timeout(const Duration(seconds: 1));
      expect(channel.output.closes, 1);
      await subscription.cancel();
    },
  );

  test('a burst of explicit connects creates only the surviving attempt', () {
    fakeAsync((clock) {
      final channel = ControlledChannel();
      var created = 0;
      final ws = ResilientWebSocket(
        'ws://unused',
        channelFactory: (_) {
          created++;
          return channel;
        },
      );
      for (var index = 0; index < 100; index++) {
        ws.connect();
      }
      clock.flushMicrotasks();
      expect(created, 1);
      channel.handshake.complete();
      clock.flushMicrotasks();
      expect(ws.isConnected, true);
      ws.close();
      clock.flushMicrotasks();
      expect(clock.pendingTimers, isEmpty);
    });
  });

  test(
    'actual delayed loopback upgrade cannot revive the closed wrapper',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final arrived = Completer<HttpRequest>();
      final requests = server.listen(arrived.complete);
      WebSocket? peer;
      var callbacks = 0;
      final ws = ResilientWebSocket(
        'ws://127.0.0.1:${server.port}/',
        cleanupTimeout: const Duration(milliseconds: 20),
        onConnect: () => callbacks++,
      );
      try {
        final connecting = ws.connect();
        final request = await arrived.future.timeout(
          const Duration(seconds: 2),
        );
        await ws.close().timeout(const Duration(seconds: 1));
        await connecting.timeout(const Duration(seconds: 1));
        peer = await WebSocketTransformer.upgrade(request);
        final ended = Completer<void>();
        peer.listen((_) {}, onDone: ended.complete, onError: (_) {});
        await ended.future.timeout(const Duration(seconds: 2));
        expect(callbacks, 0);
        expect(ws.connectionStateValue, WsConnectionState.disconnected);
        expect(ws.isConnected, false);
      } finally {
        await ws.close();
        await peer?.close();
        await requests.cancel();
        await server.close(force: true);
      }
    },
  );
}
