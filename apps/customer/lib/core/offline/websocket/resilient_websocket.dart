import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

class ResilientWebSocket {
  ResilientWebSocket(
    this.url, {
    this.initialDelay = const Duration(seconds: 2),
    this.maxDelay = const Duration(seconds: 60),
    this.maxAttempts = 10,
    this.onConnect,
    this.urlFactory,
  });

  final String url;
  final Duration initialDelay;
  final Duration maxDelay;
  final int maxAttempts;
  final void Function()? onConnect;
  final String Function()? urlFactory;

  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  Timer? _heartbeatTimer;
  Timer? _reconnectTimer;
  bool _closed = false;
  int _attempt = 0;

  final StreamController<dynamic> _controller = StreamController<dynamic>.broadcast();

  Stream<dynamic> get stream => _controller.stream;

  Future<void> connect() async {
    _closed = false;
    _attempt = 0;
    await _connectOnce();
  }

  Future<void> _connectOnce() async {
    try {
      final targetUrl = urlFactory != null ? urlFactory!() : url;
      _channel = WebSocketChannel.connect(Uri.parse(targetUrl));
      _subscription = _channel!.stream.listen(
        (message) {
          _controller.add(message);
        },
        onDone: _scheduleReconnect,
        onError: (_) => _scheduleReconnect(),
      );
      _attempt = 0;
      _startHeartbeat();
      onConnect?.call();
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void send(dynamic message) {
    final channel = _channel;
    if (channel == null) {
      return;
    }

    final payload = message is String ? message : jsonEncode(message);
    channel.sink.add(payload);
  }

  void _scheduleReconnect() {
    if (_closed) {
      return;
    }

    _heartbeatTimer?.cancel();

    if (_attempt >= maxAttempts) {
      _controller.addError(Exception('Max reconnect attempts reached ($maxAttempts)'));
      return;
    }

    final delayMs = initialDelay.inMilliseconds * (1 << _attempt.clamp(0, 5));
    final capped = Duration(
      milliseconds: delayMs > maxDelay.inMilliseconds ? maxDelay.inMilliseconds : delayMs,
    );
    _attempt += 1;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(capped, () async {
      await _cleanupChannel();
      if (_closed) {
        return;
      }
      await _connectOnce();
    });
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      final channel = _channel;
      if (channel != null) {
        channel.sink.add('ping');
      }
    });
  }

  Future<void> close() async {
    _closed = true;
    _heartbeatTimer?.cancel();
    _reconnectTimer?.cancel();
    await _cleanupChannel();
    await _controller.close();
  }

  Future<void> _cleanupChannel() async {
    await _subscription?.cancel();
    await _channel?.sink.close();
    _subscription = null;
    _channel = null;
  }
}
