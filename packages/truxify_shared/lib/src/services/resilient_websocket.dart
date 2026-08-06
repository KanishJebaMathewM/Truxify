import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

/// A WebSocket wrapper that automatically reconnects with exponential
/// backoff, sends periodic heartbeat pings, and exposes a broadcast stream.
///
/// Use [connect] to establish the connection. Listen to [stream] for
/// incoming messages. Use [send] to send messages. Call [close] to
/// terminate the connection permanently.
///
/// When the remote end closes or an error occurs, the class
/// automatically schedules a reconnect (with exponential backoff up to
/// [maxDelay]) unless [close] has been called or [maxAttempts] has been
/// reached.
class ResilientWebSocket {
  /// Creates a resilient WebSocket.
  ///
  /// * [url] — the initial WebSocket URL.
  /// * [initialDelay] — the first reconnect delay (default 2 seconds).
  /// * [maxDelay] — the maximum reconnect delay cap (default 60 seconds).
  /// * [maxAttempts] — maximum reconnect attempts before giving up (default 10).
  /// * [onConnect] — called synchronously after each (re)connection succeeds.
  /// * [urlFactory] — if provided, called on each reconnect to produce the
  ///   latest URL (useful for refreshing short-lived auth tokens).
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
  bool _reconnecting = false;
  int _attempt = 0;

  final StreamController<dynamic> _controller =
      StreamController<dynamic>.broadcast();

  /// A broadcast stream of incoming messages from the WebSocket.
  Stream<dynamic> get stream => _controller.stream;

  /// Opens (or re-opens) the WebSocket connection.
  ///
  /// Resets the reconnect attempt counter. Cancels any pending reconnect
  /// timers and cleans up any existing channel before connecting.
  /// Safe to call multiple times.
  Future<void> connect() async {
    _closed = false;
    _attempt = 0;
    _reconnecting = false;
    _heartbeatTimer?.cancel();
    _reconnectTimer?.cancel();
    await _cleanupChannel();
    await _connectOnce();
  }

  Future<void> _connectOnce() async {
    try {
      final targetUrl = urlFactory != null ? urlFactory!() : url;
      _channel = WebSocketChannel.connect(Uri.parse(targetUrl));
      // Wait for the TCP/TLS handshake to complete before proceeding.
      await _channel!.ready;
      _subscription = _channel!.stream.listen(
        (message) {
          _controller.add(message);
        },
        onDone: () {
          if (!_reconnecting) {
            _reconnecting = true;
            _scheduleReconnect();
          }
        },
        onError: (_) {
          if (!_reconnecting) {
            _reconnecting = true;
            _scheduleReconnect();
          }
        },
      );
      _attempt = 0;
      _startHeartbeat();
      onConnect?.call();
    } catch (_) {
      if (!_reconnecting) {
        _reconnecting = true;
        _scheduleReconnect();
      }
    }
  }

  /// Sends a message over the WebSocket.
  ///
  /// Strings are sent as-is. All other values are JSON-encoded.
  /// If the connection is not currently open the message is silently dropped.
  void send(dynamic message) {
    final channel = _channel;
    if (channel == null) {
      return;
    }

    final payload = message is String ? message : jsonEncode(message);
    channel.sink.add(payload);
  }

  Future<void> _scheduleReconnect() async {
    if (_closed) {
      return;
    }

    _heartbeatTimer?.cancel();

    if (_attempt >= maxAttempts) {
      _closed = true;
      await _cleanupChannel();
      _controller.addError(
        Exception('Max reconnect attempts reached ($maxAttempts)'),
      );
      return;
    }

    // Exponential backoff: 2^attempt seconds, capped at maxDelay
    final delayMs = initialDelay.inMilliseconds * (1 << _attempt.clamp(0, 5).toInt());
    final capped = Duration(
      milliseconds:
          delayMs > maxDelay.inMilliseconds ? maxDelay.inMilliseconds : delayMs,
    );
    _attempt += 1;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(capped, () async {
      _reconnecting = false;
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
      // Guard against stale channel: if the wrapper has been closed or
      // the channel was replaced between the null check and the add call,
      // silently ignore.
      if (_closed) return;
      final channel = _channel;
      if (channel != null) {
        try {
          channel.sink.add('ping');
        } catch (_) {
          // Channel was closed mid-tick — the stream listener will
          // trigger _scheduleReconnect.
        }
      }
    });
  }

  /// Permanently closes the WebSocket and releases all resources.
  ///
  /// No further reconnect attempts will be made.
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
