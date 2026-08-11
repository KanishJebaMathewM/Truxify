import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:http/http.dart' as http;

import 'package:truxify_shared/truxify_shared.dart';

import 'battery_service.dart';
import 'location_replay_service.dart';
import 'offline_location_queue.dart';
import 'secure_storage.dart';

/// Outcome of a location ping attempt.
///
/// A ping is `delivered` only when the WebSocket transport accepted it, and
/// `queued` only when it was durably persisted into the offline queue. A ping
/// that is neither must never advance the "last sent" throttle state.
enum LocationDelivery {
  /// Accepted by the WebSocket transport.
  delivered,

  /// Not accepted by the transport, but durably queued for later replay.
  queued,

  /// Neither delivered nor persisted — safe to retry on the next fix.
  failed,
}

class LocationService {
  LocationService._privateConstructor();
  static final LocationService instance = LocationService._privateConstructor();

  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
  );

  static void _assertNotLocalhost() {
    if (defaultApiBaseUrl.contains('localhost') && kReleaseMode) {
      throw AssertionError(
        'TRUXIFY_API_BASE_URL is still set to localhost in release mode. '
        'Provide a production API URL via --dart-define=TRUXIFY_API_BASE_URL=...'
      );
    }
  }

  // Use ResilientWebSocket which handles reconnection, heartbeat, and
  // exponential backoff automatically.
  ResilientWebSocket? _resilientWs;
  StreamSubscription<Position>? _positionSubscription;
  StreamSubscription? _socketSubscription;
  Timer? _maxIntervalTimer; // Fallback for max 30 seconds without ping
  bool _isTracking = false;
  String? _activeOrderId;
  String? _activeOrderDisplayId;
  int? _lastCloseCode;
  String? _authToken;

  /// Whether the current WebSocket completed the first-frame `auth` handshake
  /// (issue #5739). Location pings are only delivered over a socket once this
  /// is true — the backend otherwise rejects the connection with code 4001.
  bool _wsAuthenticated = false;

  /// Throttle state: the last location *accepted into the delivery pipeline*
  /// (either delivered over the WebSocket or durably queued for replay).
  ///
  /// It intentionally does NOT advance for a ping that was neither delivered
  /// nor persisted — a dropped message must never suppress future GPS updates
  /// by making the app believe the backend saw an earlier fix.
  Position? _lastSentPosition;
  DateTime? _lastSentTime;
  String? _lastTriggeredMilestone;

  // Durable offline queue + single replay worker for it.
  final OfflineLocationQueue _offlineQueue = OfflineLocationQueue.instance;
  final LocationReplayService _replayService = LocationReplayService.instance;

  // Throttling configuration: send ping if moved 10m+ OR 5 seconds passed
  // (Issue: Driver app must emit GPS updates every 5 seconds during active trip)
  static const double _minDistanceMeters = 10.0;
  static const Duration _maxInterval = Duration(seconds: 5);
  static const List<String> _activeOrderStatuses = [
    'truck_assigned',
    'en_route_pickup',
    'arrived_pickup',
    'picked_up',
    'in_transit',
    'arriving',
  ];

  bool get isTracking => _isTracking;

  // ── Connection status stream ──────────────────────────────────────────────
  final StreamController<WsConnectionStatus> _statusController =
      StreamController<WsConnectionStatus>.broadcast();

  /// Broadcast stream of WebSocket connection state changes.
  Stream<WsConnectionStatus> get connectionStatus => _statusController.stream;

  void _emitStatus(WsConnectionStatus status) {
    if (!_statusController.isClosed) _statusController.add(status);
  }

  /// Start GPS tracking for a given [tripId] (order display ID).
  /// If [tripId] is provided it is cached immediately so the first ping
  /// can include the correct order context without waiting for a Supabase
  /// lookup — reducing initial latency.
  Future<void> startTracking({String? tripId}) async {
    _assertNotLocalhost();
    if (_isTracking) return;

    // Check location permission before starting tracking (fixes #1491)
    final permission = await Permission.location.request();

    if (permission.isDenied) {
      debugPrint('[LocationService] Location permission denied');
      throw Exception('Location permission is required to start tracking');
    }

    if (permission.isPermanentlyDenied) {
      debugPrint('[LocationService] Location permission permanently denied');
      openAppSettings();
      throw Exception('Location permissions are permanently denied. Please open app settings.');
    }

    // Pre-seed active order display ID if the caller already knows it.
    if (tripId != null && tripId.isNotEmpty) {
      _activeOrderDisplayId = tripId;
      debugPrint('[LocationService] Pre-seeded active order display ID: $tripId');
    }

    _isTracking = true;
    _emitStatus(WsConnectionStatus.connecting);
    debugPrint('[LocationService] Starting driver location tracking...');

    // Install the replay transport hooks so the single replay worker can
    // deliver queued pings/milestones through this service's own transport.
    _installReplayHooks();

    _startPositionSubscription();
  }

  void _installReplayHooks() {
    _replayService.sendLocation = (payload) {
      final ws = _resilientWs;
      if (ws == null || !ws.isConnected || !_wsAuthenticated) {
        return WsSendResult.failed;
      }
      return ws.sendResult(payload);
    };
    _replayService.sendMilestone =
        ({required orderId, required milestone, required token}) async {
      try {
        final url = Uri.parse('$defaultApiBaseUrl/api/orders/$orderId/milestones');
        final response = await http.put(
          url,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
          body: jsonEncode({'milestone': milestone}),
        );
        // 409 = milestone already completed server-side: idempotent success.
        return response.statusCode >= 200 && response.statusCode < 300 ||
            response.statusCode == 409;
      } catch (_) {
        return false;
      }
    };
    _replayService.tokenProvider =
        () => Supabase.instance.client.auth.currentSession?.accessToken;
    _replayService.driverIdProvider =
        () => Supabase.instance.client.auth.currentUser?.id;
    _replayService.isConnected = () => _wsAuthenticated;
  }

  void stopTracking() {
    if (!_isTracking) return;
    _isTracking = false;
    debugPrint('[LocationService] Stopping driver location tracking...');
    // Abort any in-flight replay so it never outlives this tracking session.
    _replayService.requestStop();
    _positionSubscription?.cancel();
    _positionSubscription = null;
    _maxIntervalTimer?.cancel();
    _maxIntervalTimer = null;
    _lastSentPosition = null;
    _lastTriggeredMilestone = null;
    _wsAuthenticated = false;
    _activeOrderId = null;
    _activeOrderDisplayId = null;
    _closeWebSocket();
    _emitStatus(WsConnectionStatus.disconnected);
  }

  void _startPositionSubscription() {
    _positionSubscription?.cancel();
    _positionSubscription = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10, // Geolocator filters to 10m minimum movement
      ),
    ).listen(
      (position) {
        unawaited(_handleLocationUpdate(position));
      },
      onError: (error) {
        debugPrint('[LocationService] Position stream error: $error');
      },
    );

    // Fallback timer: ensure a ping is sent at least every 30 seconds
    _maxIntervalTimer?.cancel();
    _maxIntervalTimer = Timer.periodic(_maxInterval, (_) {
      if (_lastSentPosition != null && _isTracking) {
        debugPrint('[LocationService] Max interval elapsed, sending fallback ping');
        unawaited(_sendLocationPing(_lastSentPosition!));
      }
    });
  }

  Future<void> _handleLocationUpdate(Position position) async {
    // Implement displacement-based throttling
    if (_lastSentPosition == null) {
      // First position, always send
      final result = await _sendLocationPing(position);
      if (result == LocationDelivery.delivered ||
          result == LocationDelivery.queued) {
        _lastSentPosition = position;
        _lastSentTime = DateTime.now();
      }
      return;
    }

    final now = DateTime.now();
    final timeSinceLastSend = now.difference(_lastSentTime!);

    // Calculate distance moved using Geolocator
    final distanceMoved = Geolocator.distanceBetween(
      _lastSentPosition!.latitude,
      _lastSentPosition!.longitude,
      position.latitude,
      position.longitude,
    );

    // Send if: moved 15m+ OR max interval (30s) has elapsed
    if (distanceMoved >= _minDistanceMeters ||
        timeSinceLastSend.compareTo(_maxInterval) >= 0) {
      final result = await _sendLocationPing(position);
      if (result == LocationDelivery.delivered ||
          result == LocationDelivery.queued) {
        _lastSentPosition = position;
        _lastSentTime = now;
      }
    } else {
      debugPrint(
        '[LocationService] Location update throttled (moved ${distanceMoved.toStringAsFixed(1)}m, '
        'max is ${_minDistanceMeters}m)',
      );
    }
  }

  /// Sends a location ping, or durably queues it when the transport is
  /// unavailable. Returns [LocationDelivery]:
  ///
  /// * `delivered` — the WebSocket accepted it; throttle state may advance.
  /// * `queued` — persisted to the offline queue; throttle state may advance
  ///   (the fix is guaranteed to be replayed later).
  /// * `failed` — neither delivered nor persisted; throttle state MUST NOT
  ///   advance so the next fix retries.
  Future<LocationDelivery> _sendLocationPing(Position position) async {
    try {
      final driverId = Supabase.instance.client.auth.currentUser?.id;
      if (driverId == null || driverId.isEmpty) return LocationDelivery.failed;

      if (_activeOrderId != null) {
        try {
          final cachedOrder = await Supabase.instance.client
              .from('orders')
              .select('id, status, pickup_lat, pickup_lng, drop_lat, drop_lng')
              .eq('id', _activeOrderId!)
              .eq('driver_id', driverId)
              .inFilter('status', _activeOrderStatuses)
              .maybeSingle();

          if (cachedOrder == null) {
            _activeOrderId = null;
            _activeOrderDisplayId = null;
            _lastTriggeredMilestone = null;
          } else {
            unawaited(_checkGeofence(cachedOrder, position));
          }
        } catch (_) {
          // Server unreachable (fully offline). Keep the cached order context
          // so the ping can still be persisted for offline replay instead of
          // being dropped by a Supabase lookup failure.
          debugPrint(
            '[LocationService] Order re-validation failed — keeping cached order context',
          );
        }
      }

      // 1. Resolve active order if not cached
      if (_activeOrderId == null) {
        final activeOrder = await Supabase.instance.client
            .from('orders')
            .select('id, order_display_id, status, pickup_lat, pickup_lng, drop_lat, drop_lng')
            .eq('driver_id', driverId)
            .inFilter('status', _activeOrderStatuses)
            .maybeSingle();

        if (activeOrder != null) {
          _activeOrderId = activeOrder['id']?.toString();
          _activeOrderDisplayId = activeOrder['order_display_id']?.toString();
          unawaited(_checkGeofence(activeOrder, position));
        }
      }

      final orderId = _activeOrderId;
      final orderDisplayId = _activeOrderDisplayId;
      if (orderId == null || orderDisplayId == null) {
        debugPrint('[LocationService] No active order found; skipping order telemetry ping');
        return LocationDelivery.failed;
      }

      // 2. Ensure WebSocket is connected (ResilientWebSocket handles
      //    reconnection and heartbeat automatically).
      if (_resilientWs == null) {
        await _connectWebSocket();
      }

      final payload = _buildLocationPayload(
        position,
        driverId: driverId,
        orderId: orderId,
        orderDisplayId: orderDisplayId,
      );

      // 3. Try the live transport first. Delivery is gated on a completed
      //    `auth` handshake — the backend otherwise closes the socket with
      //    code 4001.
      final ws = _resilientWs;
      if (ws != null && ws.isConnected && _wsAuthenticated) {
        final result = ws.sendResult(payload);
        if (result == WsSendResult.delivered) {
          debugPrint('[LocationService] Location ping sent: lat=${position.latitude}, lng=${position.longitude}');
          return LocationDelivery.delivered;
        }
        debugPrint('[LocationService] Location ping not accepted by WebSocket');
      } else {
        debugPrint('[LocationService] WebSocket unavailable — persisting ping for offline replay');
      }

      // 4. Transport unavailable: persist durably. Successfully persisted
      //    items are guaranteed to be replayed after reconnect.
      final queued = await _offlineQueue.enqueueLocation(payload);
      if (queued) {
        debugPrint('[LocationService] Location ping queued for offline delivery');
        return LocationDelivery.queued;
      }
      debugPrint('[LocationService] Failed to queue location ping for delivery');
      return LocationDelivery.failed;
    } catch (e) {
      debugPrint('[LocationService] Error sending location ping: $e');
      return LocationDelivery.failed;
    }
  }

  /// Builds the exact `location_ping` message the backend tracking WebSocket
  /// contract expects (kept in sync with `tracker.js`): a `{event, data}`
  /// envelope whose `data` carries the telemetry fields the server validates.
  ///
  /// This is the format used both for live delivery and for offline replay, so
  /// replayed pings are byte-identical to live ones.
  Map<String, dynamic> _buildLocationPayload(
    Position position, {
    required String driverId,
    required String orderId,
    required String orderDisplayId,
  }) {
    final batteryInfo = BatteryService.instance.currentInfo;
    return {
      'event': 'location_ping',
      'data': {
        'driver_id': driverId,
        'driverId': driverId,
        'order_display_id': orderDisplayId,
        'orderId': orderId,
        'latitude': position.latitude,
        'longitude': position.longitude,
        'lat': position.latitude,
        'lng': position.longitude,
        'speed': position.speed,
        'bearing': position.heading,
        'device_timestamp': DateTime.now().toIso8601String(),
        'timestamp': DateTime.now().toIso8601String(),
        'battery_level': batteryInfo.level,
        'charging_status': batteryInfo.isCharging ? 'charging' : 'discharging',
      },
    };
  }

  Future<void> _checkGeofence(Map<String, dynamic> order, Position position) async {
    final status = order['status']?.toString();
    final orderId = order['id']?.toString();
    if (status == null || orderId == null) return;

    if (status == 'en_route_pickup' && _lastTriggeredMilestone != 'Arrived at Pickup') {
      final pickupLat = double.tryParse(order['pickup_lat']?.toString() ?? '');
      final pickupLng = double.tryParse(order['pickup_lng']?.toString() ?? '');
      if (pickupLat != null && pickupLng != null) {
        final distance = Geolocator.distanceBetween(
          position.latitude, position.longitude, pickupLat, pickupLng,
        );
        if (distance < 500) {
          await _updateOrderMilestone(orderId, 'Arrived at Pickup');
        }
      }
    } else if (status == 'in_transit' && _lastTriggeredMilestone != 'Arriving') {
      final dropLat = double.tryParse(order['drop_lat']?.toString() ?? '');
      final dropLng = double.tryParse(order['drop_lng']?.toString() ?? '');
      if (dropLat != null && dropLng != null) {
        final distance = Geolocator.distanceBetween(
          position.latitude, position.longitude, dropLat, dropLng,
        );
        if (distance < 500) {
          await _updateOrderMilestone(orderId, 'Arriving');
        }
      }
    }
  }

  /// Delivers a geofence milestone, persisting it for idempotent retry when
  /// the backend is unreachable.
  ///
  /// Reliability contract:
  /// 1. A pending entry for the same logical milestone (order + type) blocks
  ///    duplicate delivery — the milestone is already in the pipeline.
  /// 2. Success (2xx) or "already completed" (409) marks it delivered.
  /// 3. Any other failure persists it to the offline queue with a stable
  ///    idempotency key (`milestone:{orderId}:{milestone}`) so retries reuse
  ///    the same identity and never create duplicate order-state transitions.
  Future<void> _updateOrderMilestone(String orderId, String milestone) async {
    final driverId = Supabase.instance.client.auth.currentUser?.id;
    if (driverId == null || driverId.isEmpty) return;

    // Already guaranteed delivery by a queued entry — do not re-trigger.
    if (await _offlineQueue.containsPendingMilestone(
      orderId: orderId,
      milestone: milestone,
    )) {
      return;
    }

    final token = Supabase.instance.client.auth.currentSession?.accessToken;
    if (token == null) {
      await _queueMilestone(orderId, milestone, driverId);
      return;
    }

    try {
      final url = Uri.parse('$defaultApiBaseUrl/api/orders/$orderId/milestones');
      final response = await http.put(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({'milestone': milestone}),
      );

      if (response.statusCode >= 200 && response.statusCode < 300) {
        _lastTriggeredMilestone = milestone;
        debugPrint('[LocationService] Successfully auto-triggered milestone: $milestone');
        return;
      }
      if (response.statusCode == 409) {
        // Already completed server-side — idempotent, stop re-triggering.
        _lastTriggeredMilestone = milestone;
        debugPrint('[LocationService] Milestone $milestone already completed server-side');
        return;
      }
      debugPrint('[LocationService] Failed to auto-trigger milestone $milestone. Status: ${response.statusCode}');
    } catch (e) {
      debugPrint('[LocationService] Exception triggering milestone $milestone: $e');
    }

    await _queueMilestone(orderId, milestone, driverId);
  }

  Future<void> _queueMilestone(String orderId, String milestone, String driverId) async {
    final queued = await _offlineQueue.enqueueMilestone(
      orderId: orderId,
      milestone: milestone,
      driverId: driverId,
    );
    if (queued) {
      // The milestone is now durably in the pipeline — advancing this guard
      // prevents re-triggering and creating duplicate queue entries.
      _lastTriggeredMilestone = milestone;
      debugPrint('[LocationService] Milestone $milestone queued for offline delivery');
    }
  }

  /// Builds the WebSocket URI for the tracking endpoint.
  ///
  /// Auth tokens are deliberately NOT included in the URL — they are sent via
  /// a first-frame `auth` handshake after the socket connects (issue #5739) —
  /// so they never leak into proxies, logs or web analytics.
  Uri _buildWsUri() {
    final session = Supabase.instance.client.auth.currentSession;
    final token = session?.accessToken;
    if (token != null && token.isNotEmpty) {
      _authToken = token;
      unawaited(AuthTokenStore.persist(token));
    }
    final driverId = Supabase.instance.client.auth.currentUser?.id ?? '';

    final baseUri = Uri.parse(defaultApiBaseUrl);
    final wsScheme = baseUri.scheme == 'https' ? 'wss' : 'ws';
    var wsPath = baseUri.path;
    if (wsPath.endsWith('/')) {
      wsPath = wsPath.substring(0, wsPath.length - 1);
    }
    wsPath = '$wsPath/ws/tracking';

    return Uri(
      scheme: wsScheme,
      host: baseUri.host,
      port: baseUri.hasPort ? baseUri.port : null,
      path: wsPath,
    );
  }

  /// Establishes the WebSocket connection for live GPS tracking.
  ///
  /// Uses [ResilientWebSocket] which handles reconnection, exponential
  /// backoff and heartbeat pings automatically. A fresh instance is created
  /// on demand so reconnects always re-run [_buildWsUri] for a current URL.
  ///
  /// The backend authenticates via a first-frame `auth` event (issue #5739):
  /// as soon as the socket connects we present the bearer token as a message
  /// — never in the URL query string, where it would leak through proxies,
  /// logs and web analytics. Only after the server confirms with
  /// `{status: 'authenticated'}` are location pings delivered.
  Future<void> _connectWebSocket() async {
    _socketSubscription?.cancel();
    _socketSubscription = null;
    _lastCloseCode = null;
    _wsAuthenticated = false;

    final ws = ResilientWebSocket(
      _buildWsUri().toString(),
      onConnect: () async {
        _emitStatus(WsConnectionStatus.connected);
        // The auth handshake runs on every (re)connect — the server requires
        // the token as a first frame on each new TCP/TLS session.
        _wsAuthenticated = false;
        final token = await _resolveAuthToken();
        if (token != null && token.isNotEmpty) {
          ws.send({'event': 'auth', 'data': {'token': token}});
        }
      },
      urlFactory: () => _buildWsUri().toString(),
    );
    _resilientWs = ws;

    _socketSubscription = ws.stream.listen(
      (message) {
        if (message == 'pong') return;
        debugPrint('[LocationService] Received WebSocket message: $message');
        try {
          final parsed = jsonDecode(message.toString());
          if (parsed is Map) {
            if (parsed['status'] == 'authenticated') {
              // Auth handshake complete — safe to deliver pings and to flush
              // anything queued while offline.
              _wsAuthenticated = true;
              unawaited(_replayService.kick());
              return;
            }
            if (parsed['code'] != null) {
              _lastCloseCode = parsed['code'] as int;
              if (_lastCloseCode == 4001 || _lastCloseCode == 4003) {
                debugPrint(
                  '[LocationService] Auth rejected (code $_lastCloseCode) — stopping tracking',
                );
                ws.close();
                _resilientWs = null;
                stopTracking();
                return;
              }
            }
          }
        } catch (_) {}
      },
      onError: (error) {
        debugPrint('[LocationService] WebSocket error: $error');
        // If the error is terminal (e.g. max reconnect attempts reached),
        // clear the instance so the next _sendLocationPing will create
        // a fresh ResilientWebSocket.
        _resilientWs = null;
      },
    );

    _emitStatus(WsConnectionStatus.connecting);
    await ws.connect();
  }

  /// Resolves the auth token used for the WS handshake, preferring the live
  /// Supabase session and falling back to the token persisted in OS-backed
  /// secure storage (issue #5739).
  Future<String?> _resolveAuthToken() async {
    final session = Supabase.instance.client.auth.currentSession;
    final token = session?.accessToken;
    if (token != null && token.isNotEmpty) {
      await AuthTokenStore.persist(token);
      return token;
    }
    return AuthTokenStore.read();
  }

  void _closeWebSocket() {
    _socketSubscription?.cancel();
    _socketSubscription = null;
    _resilientWs?.close();
    _resilientWs = null;
  }

  /// Call once when the app is permanently shutting down to close the status
  /// stream and prevent resource leaks.
  void dispose() {
    stopTracking();
    _statusController.close();
  }
}

/// WebSocket connection state emitted by [LocationService.connectionStatus].
enum WsConnectionStatus {
  connecting,
  connected,
  reconnecting,
  disconnected,
}
