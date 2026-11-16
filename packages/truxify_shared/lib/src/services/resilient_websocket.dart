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

  /// The channel is established; application authentication is separate.
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
  /// Creates a resilient transport with exponential reconnect backoff.
  /// [onConnect] runs synchronously after each successful current handshake.
  /// [urlFactory] refreshes the URL on every connection attempt.
  /// [channelFactory] supports alternative transports and controlled tests.
  /// [handshakeTimeout] bounds ready waiting; [cleanupTimeout] bounds how long
  /// this wrapper waits for detached transport cancellation/closure.
  ResilientWebSocket(
    this.url, {
    this.initialDelay = const Duration(seconds: 2),
    this.maxDelay = const Duration(seconds: 60),
    this.maxAttempts = 10,
    this.onConnect,
    this.urlFactory,
    this.handshakeTimeout = const Duration(seconds: 10),
    this.cleanupTimeout = const Duration(seconds: 1),
    WebSocketChannel Function(Uri)? channelFactory,
  }) : _channelFactory = channelFactory ?? WebSocketChannel.connect {
    if (handshakeTimeout <= Duration.zero || cleanupTimeout <= Duration.zero) {
      throw ArgumentError('Handshake and cleanup deadlines must be positive');
    }
  }

  final String url;
  final Duration initialDelay;
  final Duration maxDelay;
  final int maxAttempts;
  final void Function()? onConnect;
  final String Function()? urlFactory;
  final Duration handshakeTimeout;
  final Duration cleanupTimeout;
  final WebSocketChannel Function(Uri) _channelFactory;

  _ConnectionAttempt? _transport;
  Timer? _heartbeatTimer;
  Timer? _reconnectTimer;
  bool _disposed = false;
  int _generation = 0;
  int _attempt = 0;
  int _listenerCount = 0;
  Object? _lastError;
  StackTrace? _lastStackTrace;
  Future<void>? _closing;
  // Existing disconnected FIFO replay policy is preserved until permanent close.
  final List<dynamic> _pendingOutbound = [];

  // Lazy initialization permits callbacks to reference this instance. A normal
  // field initializer cannot access instance members in Dart.
  late final StreamController<dynamic> _controller =
      StreamController<dynamic>.broadcast(
        onListen: () {
          _listenerCount++;
          if (_lastError != null) {
            _emitError(_lastError!, _lastStackTrace);
          }
        },
        onCancel: () {
          if (_listenerCount > 0) _listenerCount--;
        },
      );
  final StreamController<WsConnectionState> _stateController =
      StreamController<WsConnectionState>.broadcast();
  WsConnectionState _connectionState = WsConnectionState.disconnected;

  /// Broadcast incoming messages from the current connection only.
  Stream<dynamic> get stream => _controller.stream;

  /// Most recent terminal error, retained for late subscribers.
  Object? get lastError => _lastError;

  /// Broadcast connection state transitions.
  Stream<WsConnectionState> get connectionState => _stateController.stream;
  WsConnectionState get connectionStateValue => _connectionState;
  bool get isConnected =>
      !_disposed &&
      _connectionState == WsConnectionState.connected &&
      _transport != null;

  bool _isCurrent(int generation) => !_disposed && generation == _generation;

  bool _owns(_ConnectionAttempt transport) =>
      _isCurrent(transport.generation) && identical(_transport, transport);

  void _setConnectionState(WsConnectionState state) {
    if (_connectionState == state) return;
    _connectionState = state;
    if (!_stateController.isClosed) _stateController.add(state);
  }

  /// Opens/replaces a connection or recovers a terminal failed attempt.
  /// Permanent [close] is terminal; create a new wrapper after disposal.
  Future<void> connect() async {
    if (_disposed) return;
    final generation = ++_generation;
    _cancelTimers();
    final previous = _detachTransport();
    _attempt = 0;
    _lastError = null;
    _lastStackTrace = null;
    _setConnectionState(WsConnectionState.connecting);
    await _disposeTransport(previous);
    if (_isCurrent(generation)) await _connectOnce(generation);
  }

  void _emitError(Object error, [StackTrace? stackTrace]) {
    if (_controller.isClosed) return;
    _lastError = error;
    _lastStackTrace = stackTrace;
    if (_listenerCount > 0) _controller.addError(error, stackTrace);
  }

  Future<void> _connectOnce(int generation) async {
    if (!_isCurrent(generation)) return;
    try {
      final targetUrl = urlFactory != null ? urlFactory!() : url;
      if (!_isCurrent(generation)) return;
      final transport = _ConnectionAttempt(
        generation,
        _channelFactory(Uri.parse(targetUrl)),
      );
      if (!_isCurrent(generation)) {
        // A custom factory may synchronously replace/close this wrapper.
        transport.cancelled.complete();
        // Observe a later handshake rejection even though it was never adopted.
        unawaited(transport.channel.ready.then<void>((_) {}, onError: (_) {}));
        await _disposeTransport(transport);
        return;
      }
      _transport = transport;
      // Listen before ready: failed handshakes also emit stream errors.
      transport.subscription = transport.channel.stream.listen(
        (message) {
          if (_owns(transport) && !_controller.isClosed) {
            _controller.add(message);
          }
        },
        onDone: () => _scheduleReconnect(generation),
        onError: (Object error, StackTrace stack) =>
            _scheduleReconnect(generation),
      );
      final ready = await Future.any<bool>([
        transport.channel.ready.then((_) => true),
        transport.cancelled.future.then((_) => false),
      ]).timeout(handshakeTimeout);
      // Capture the channel above; never resume through a mutable field.
      if (!ready || !_owns(transport)) return;
      _attempt = 0;
      _lastError = null;
      _lastStackTrace = null;
      _setConnectionState(WsConnectionState.connected);
      _startHeartbeat(transport);
      onConnect?.call();
      if (_owns(transport)) _drainPendingOutbound(transport);
    } catch (_) {
      _scheduleReconnect(generation);
    }
  }

  /// Transport acceptance only; disconnected messages retain existing FIFO
  /// replay behavior. Permanently closed wrappers reject without buffering.
  WsSendResult sendResult(dynamic message) {
    if (_disposed) return WsSendResult.failed;
    final transport = _transport;
    if (isConnected && transport != null) {
      try {
        transport.channel.sink.add(
          message is String ? message : jsonEncode(message),
        );
        return WsSendResult.delivered;
      } catch (_) {
        _pendingOutbound.add(message);
        _scheduleReconnect(transport.generation);
        return WsSendResult.failed;
      }
    }
    _pendingOutbound.add(message);
    return WsSendResult.failed;
  }

  bool send(dynamic message) => sendResult(message) == WsSendResult.delivered;

  void _drainPendingOutbound(_ConnectionAttempt transport) {
    while (_owns(transport) && _pendingOutbound.isNotEmpty) {
      final message = _pendingOutbound.first;
      try {
        transport.channel.sink.add(
          message is String ? message : jsonEncode(message),
        );
        _pendingOutbound.removeAt(0);
      } catch (_) {
        _scheduleReconnect(transport.generation);
        break;
      }
    }
  }

  void _scheduleReconnect(int generation) {
    if (!_isCurrent(generation)) return;
    final nextGeneration = ++_generation;
    _cancelTimers();
    final previous = _detachTransport();
    // Detachment happens before awaiting cleanup. Late old callbacks cannot
    // reconnect, erase, or emit messages into the replacement connection.
    unawaited(_disposeTransport(previous));
    if (_attempt >= maxAttempts) {
      _setConnectionState(WsConnectionState.failed);
      _emitError(Exception('Max reconnect attempts reached ($maxAttempts)'));
      return;
    }
    final delayMs =
        initialDelay.inMilliseconds * (1 << _attempt.clamp(0, 5).toInt());
    final capped = Duration(
      milliseconds: delayMs > maxDelay.inMilliseconds
          ? maxDelay.inMilliseconds
          : delayMs,
    );
    _attempt++;
    _setConnectionState(WsConnectionState.reconnecting);
    _reconnectTimer = Timer(capped, () {
      if (!_isCurrent(nextGeneration)) return;
      _setConnectionState(WsConnectionState.connecting);
      unawaited(_connectOnce(nextGeneration));
    });
  }

  void _startHeartbeat(_ConnectionAttempt transport) {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (!_owns(transport)) return;
      try {
        transport.channel.sink.add('ping');
      } catch (_) {
        _scheduleReconnect(transport.generation);
      }
    });
  }

  void _cancelTimers() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
  }

  _ConnectionAttempt? _detachTransport() {
    final previous = _transport;
    _transport = null;
    if (previous != null && !previous.cancelled.isCompleted) {
      previous.cancelled.complete();
    }
    return previous;
  }

  Future<void> _disposeTransport(_ConnectionAttempt? transport) async {
    if (transport == null) return;
    // Close/cancel can wait on a stalled handshake or stream consumer. Start
    // both now; bound our wait without claiming OS-level handshake abortion.
    Future<void> bounded(Future<dynamic> Function() operation) async {
      try {
        await operation().timeout(cleanupTimeout);
      } catch (_) {
        // Future.timeout observes late errors; cleanup never mutates ownership.
      }
    }

    await Future.wait([
      bounded(() async => transport.subscription?.cancel()),
      bounded(() => transport.channel.sink.close()),
    ]);
  }

  /// Permanently disables connections, timers and outbound replay immediately.
  /// Waits at most [cleanupTimeout] for each detached transport cleanup action.
  Future<void> close() {
    if (_closing != null) return _closing!;
    _disposed = true;
    ++_generation;
    _cancelTimers();
    _pendingOutbound.clear();
    final previous = _detachTransport();
    _connectionState = WsConnectionState.disconnected;
    if (!_stateController.isClosed) {
      _stateController.add(WsConnectionState.disconnected);
    }
    _closing = _finishClose(previous);
    return _closing!;
  }

  Future<void> _finishClose(_ConnectionAttempt? previous) async {
    await _disposeTransport(previous);
    // A paused caller subscription can delay broadcast done delivery; do not
    // make transport shutdown depend on the caller resuming that subscription.
    unawaited(_controller.close());
    unawaited(_stateController.close());
  }

  Future<void> reconnect() => connect();
}

class _ConnectionAttempt {
  _ConnectionAttempt(this.generation, this.channel);
  final int generation;
  final WebSocketChannel channel;
  final Completer<void> cancelled = Completer<void>();
  StreamSubscription<dynamic>? subscription;
}
