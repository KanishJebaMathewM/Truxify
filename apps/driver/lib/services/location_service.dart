import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

class LocationService {
  LocationService._privateConstructor();
  static final LocationService instance = LocationService._privateConstructor();

  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  WebSocketChannel? _channel;
  StreamSubscription<Position>? _positionSubscription;
  Timer? _reconnectTimer;
  Timer? _heartbeatTimer;
  Timer? _maxIntervalTimer; // Fallback for max 30 seconds without ping
  bool _isTracking = false;
  String? _activeOrderId;
  String? _activeOrderDisplayId;
  int _reconnectAttempts = 0;
  Position? _lastSentPosition;
  DateTime? _lastSentTime;

  // Throttling configuration: send ping if moved 15m+ OR 30 seconds passed
  static const double _minDistanceMeters = 15.0;
  static const Duration _maxInterval = Duration(seconds: 30);
  static const List<String> _activeOrderStatuses = [
    'truck_assigned',
    'en_route_pickup',
    'arrived_pickup',
    'picked_up',
    'in_transit',
    'arriving',
  ];

  bool get isTracking => _isTracking;

  Future<void> startTracking() async {
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
      throw Exception('Location permissions are permanently denied. Please enable in app settings.');
    }

    _isTracking = true;
    debugPrint('[LocationService] Starting driver location tracking...');
    _startPositionSubscription();
  }

  void stopTracking() {
    if (!_isTracking) return;
    _isTracking = false;
    debugPrint('[LocationService] Stopping driver location tracking...');
    _positionSubscription?.cancel();
    _positionSubscription = null;
    _maxIntervalTimer?.cancel();
    _maxIntervalTimer = null;
    _lastSentPosition = null;
    _closeWebSocket();
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
        _handleLocationUpdate(position);
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
        _sendLocationPing(_lastSentPosition!);
      }
    });
  }

  void _handleLocationUpdate(Position position) {
    // Implement displacement-based throttling
    if (_lastSentPosition == null) {
      // First position, always send
      _sendLocationPing(position);
      _lastSentPosition = position;
      _lastSentTime = DateTime.now();
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
      _sendLocationPing(position);
      _lastSentPosition = position;
      _lastSentTime = now;
    } else {
      debugPrint(
        '[LocationService] Location update throttled (moved ${distanceMoved.toStringAsFixed(1)}m, '
        'max is ${_minDistanceMeters}m)',
      );
    }
  }

  Future<void> _sendLocationPing(Position position) async {
    try {
      final driverId = Supabase.instance.client.auth.currentUser?.id;
      if (driverId == null || driverId.isEmpty) return;

      if (_activeOrderId != null) {
        final cachedOrder = await Supabase.instance.client
            .from('orders')
            .select('id')
            .eq('id', _activeOrderId!)
            .eq('driver_id', driverId)
            .inFilter('status', _activeOrderStatuses)
            .maybeSingle();

        if (cachedOrder == null) {
          _activeOrderId = null;
          _activeOrderDisplayId = null;
        }
      }

      // 1. Resolve active order if not cached
      if (_activeOrderId == null) {
        final activeOrder = await Supabase.instance.client
            .from('orders')
            .select('id, order_display_id')
            .eq('driver_id', driverId)
            .inFilter('status', _activeOrderStatuses)
            .maybeSingle();

        if (activeOrder != null) {
          _activeOrderId = activeOrder['id']?.toString();
          _activeOrderDisplayId = activeOrder['order_display_id']?.toString();
        }
      }

      final orderId = _activeOrderId;
      final orderDisplayId = _activeOrderDisplayId;
      if (orderId == null || orderDisplayId == null) {
        debugPrint('[LocationService] No active order found; skipping order telemetry ping');
        return;
      }

      // 2. Ensure WebSocket is connected
      if (_channel == null) {
        await _connectWebSocket();
      }

      if (_channel != null) {
        final payload = {
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
          }
        };
        _channel!.sink.add(jsonEncode(payload));
        debugPrint('[LocationService] Location ping sent: lat=${position.latitude}, lng=${position.longitude}');
      }
    } catch (e) {
      debugPrint('[LocationService] Error sending location ping: $e');
    }
  }

  Future<void> _connectWebSocket() async {
    if (_channel != null) return;

    final session = Supabase.instance.client.auth.currentSession;
    final token = session?.accessToken ?? '';
    final driverId = Supabase.instance.client.auth.currentUser?.id ?? '';

    final baseUri = Uri.parse(defaultApiBaseUrl);
    final wsScheme = baseUri.scheme == 'https' ? 'wss' : 'ws';
    var wsPath = baseUri.path;
    if (wsPath.endsWith('/')) {
      wsPath = wsPath.substring(0, wsPath.length - 1);
    }
    wsPath = '$wsPath/ws/tracking';

    final wsUri = Uri(
      scheme: wsScheme,
      host: baseUri.host,
      port: baseUri.hasPort ? baseUri.port : null,
      path: wsPath,
      queryParameters: {
        if (token.isNotEmpty) 'token': token,
        'driver_id': driverId,
      },
    );

    try {
      debugPrint('[LocationService] Connecting to WebSocket at: ${wsUri.toString()}');
      _channel = WebSocketChannel.connect(wsUri);
      _reconnectAttempts = 0;
      
      _startHeartbeat();

      _channel!.stream.listen(
        (message) {
          if (message == 'pong') return;
          debugPrint('[LocationService] Received WebSocket message: $message');
        },
        onDone: () {
          debugPrint('[LocationService] WebSocket closed');
          _scheduleReconnect();
        },
        onError: (error) {
          debugPrint('[LocationService] WebSocket error: $error');
          _scheduleReconnect();
        },
      );
    } catch (e) {
      debugPrint('[LocationService] Error connecting to WebSocket: $e');
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    _channel = null;
    _heartbeatTimer?.cancel();
    _reconnectTimer?.cancel();

    if (!_isTracking) return;

    final delay = Duration(seconds: _reconnectAttempts == 0 ? 2 : 2 * _reconnectAttempts);
    final capped = delay > const Duration(seconds: 30) ? const Duration(seconds: 30) : delay;
    _reconnectAttempts++;

    _reconnectTimer = Timer(capped, () async {
      debugPrint('[LocationService] Attempting to reconnect WebSocket (attempt $_reconnectAttempts)...');
      await _connectWebSocket();
    });
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (_channel != null) {
        _channel!.sink.add('ping');
      }
    });
  }

  void _closeWebSocket() {
    _heartbeatTimer?.cancel();
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _channel = null;
    _activeOrderId = null;
    _activeOrderDisplayId = null;
  }
}
