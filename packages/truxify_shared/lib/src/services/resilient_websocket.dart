import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

/// Connection state of a [ResilientWebSocket].
///
/// The wrapper tracks the real transport lifecycle so callers can react to
/// reconnects and so [send] never pretends a dead socket is writable.
enum WsConnectionState {
  /// No channel exists yet and no connect has been requested.
  disconnected,

  /// A connect has been requested but the TCP/TLS handshake has not completed.
  connecting,

  /// The channel is established, authenticated transport is ready.
  connected,

  /// The remote end closed/errored and a reconnect is scheduled (backoff).
  reconnecting,

  /// The wrapper gave up after exhausting [maxAttempts] and will not
  /// reconnect unless [connect] is called again.
  failed,
}

/// Outcome of a single [ResilientWebSocket.sendResult] call.
///
/// This describes transport acceptance only — a message is `delivered` once it
/// was handed to an actually-connected socket. It says nothing about whether
/// the remote processed it. Callers that need stronger guarantees must buffer
/// the message themselves until the remote acknowledges it.
enum WsSendResult {
  /// The message was handed to a live, connected socket.
  delivered,

  /// The message was NOT handed to the socket (disconnected, reconnecting,
  /// connecting, permanently failed, or the channel threw).
  failed,
}

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

  final StreamController<WsConnectionState> _stateController =
      StreamController<WsConnectionState>.broadcast();
  WsConnectionState _connectionState = WsConnectionState.disconnected;

  /// A broadcast stream of incoming messages from the WebSocket.
  Stream<dynamic> get stream => _controller.stream;

  /// A broadcast stream of connection state transitions. Emits every time
  /// the wrapper enters a new [WsConnectionState].
  Stream<WsConnectionState> get connectionState => _stateController.stream;

  /// The current connection state of the wrapper.
  WsConnectionState get connectionStateValue => _connectionState;

  void _setConnectionState(WsConnectionState state) {
    if (_connectionState == state) return;
    _connectionState = state;
    if (!_stateController.isClosed) {
      _stateController.add(state);
    }
  }

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
    _setConnectionState(WsConnectionState.connecting);
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
      _setConnectionState(WsConnectionState.connected);
      onConnect?.call();
    } catch (_) {
      if (!_reconnecting) {
        _reconnecting = true;
        _scheduleReconnect();
      }
    }
  }

  /// Whether the WebSocket connection is currently active and ready.
  bool get isConnected => _connectionState == WsConnectionState.connected;

  /// Sends a message over the WebSocket.
  ///
  /// Strings are sent as-is. All other values are JSON-encoded.
  ///
  /// Returns a [WsSendResult]. A message is only reported `delivered` when the
  /// socket is in the `connected` state — messages sent while connecting,
  /// reconnecting, disconnected, or permanently failed are reported `failed`
  /// so callers can buffer them for later replay instead of silently losing
  /// them.
  ///
  /// See also [send], the backwards-compatible boolean wrapper.
  WsSendResult sendResult(dynamic message) {
    if (_connectionState != WsConnectionState.connected) {
      return WsSendResult.failed;
    }
    final channel = _channel;
    if (channel == null) {
      return WsSendResult.failed;
    }

    try {
      final payload = message is String ? message : jsonEncode(message);
      channel.sink.add(payload);
      return WsSendResult.delivered;
    } catch (_) {
      return WsSendResult.failed;
    }
  }

  /// Backwards-compatible boolean form of [sendResult].
  ///
  /// Returns `true` only when the message was actually handed to a live
  /// socket; `false` when the connection is unavailable (disconnected,
  /// connecting, reconnecting, or permanently failed).
  bool send(dynamic message) =>
      sendResult(message) == WsSendResult.delivered;

  Future<void> _scheduleReconnect() async {
    if (_closed) {
      return;
    }

    _heartbeatTimer?.cancel();

    if (_attempt >= maxAttempts) {
      _closed = true;
      _setConnectionState(WsConnectionState.failed);
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
    _setConnectionState(WsConnectionState.reconnecting);
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(capped, () async {
      _reconnecting = false;
      _setConnectionState(WsConnectionState.connecting);
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
    _connectionState = WsConnectionState.disconnected;
    // Always emit — even a never-connected instance must surface the final
    // state to listeners.
    if (!_stateController.isClosed) {
      _stateController.add(WsConnectionState.disconnected);
    }
    await _cleanupChannel();
    await _controller.close();
    await _stateController.close();
  }

  Future<void> _cleanupChannel() async {
    await _subscription?.cancel();
    await _channel?.sink.close();
    _subscription = null;
    _channel = null;
  }
}
