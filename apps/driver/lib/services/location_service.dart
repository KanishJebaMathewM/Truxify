import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:http/http.dart' as http;

import 'battery_service.dart';

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

  WebSocketChannel? _channel;
  StreamSubscription<Position>? _positionSubscription;
  StreamSubscription? _socketSubscription;
  Timer? _reconnectTimer;
  Timer? _heartbeatTimer;
  Timer? _maxIntervalTimer; // Fallback for max 30 seconds without ping
  bool _isTracking = false;
  String? _activeOrderId;
  String? _activeOrderDisplayId;
  int _reconnectAttempts = 0;
  int? _lastCloseCode;
  Position? _lastSentPosition;
  DateTime? _lastSentTime;
  String? _lastTriggeredMilestone;

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
    _lastTriggeredMilestone = null;
    _activeOrderId = null;
    _activeOrderDisplayId = null;
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
      final sent = await _sendLocationPing(position);
      if (sent) {
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
      final sent = await _sendLocationPing(position);
      if (sent) {
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

  Future<bool> _sendLocationPing(Position position) async {
    try {
      final driverId = Supabase.instance.client.auth.currentUser?.id;
      if (driverId == null || driverId.isEmpty) return false;

      if (_activeOrderId != null) {
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
        return false;
      }

      // 2. Ensure WebSocket is connected
      if (_channel == null) {
        await _connectWebSocket();
      }

      if (_channel != null) {
        final batteryInfo = BatteryService.instance.currentInfo;
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
            'battery_level': batteryInfo.level,
            'charging_status': batteryInfo.isCharging ? 'charging' : 'discharging',
          }
        };
        _channel!.sink.add(jsonEncode(payload));
        debugPrint('[LocationService] Location ping sent: lat=${position.latitude}, lng=${position.longitude}');
        return true;
      }
      return false;
    } catch (e) {
      debugPrint('[LocationService] Error sending location ping: $e');
      return false;
    }
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

  Future<void> _updateOrderMilestone(String orderId, String milestone) async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      final token = session?.accessToken;
      if (token == null) return;
      
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
      } else {
        debugPrint('[LocationService] Failed to auto-trigger milestone $milestone. Status: ${response.statusCode}');
      }
    } catch (e) {
      debugPrint('[LocationService] Exception triggering milestone $milestone: $e');
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
      _lastCloseCode = null;
      
      _startHeartbeat();

      _socketSubscription = _channel!.stream.listen(
        (message) {
          if (message == 'pong') return;
          debugPrint('[LocationService] Received WebSocket message: $message');
          try {
            final parsed = jsonDecode(message.toString());
            if (parsed is Map && parsed['code'] != null) {
              _lastCloseCode = parsed['code'] as int;
            }
          } catch (_) {}
        },
        onDone: () {
          debugPrint('[LocationService] WebSocket closed (code: $_lastCloseCode)');
          if (_lastCloseCode == 4001 || _lastCloseCode == 4003) {
            debugPrint('[LocationService] Auth rejected (code $_lastCloseCode) — not reconnecting');
            _isTracking = false;
            return;
          }
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
    _closeWebSocket();
    _channel = null;
    final socketSubscription = _socketSubscription;
    _socketSubscription = null;
    if (socketSubscription != null) {
      unawaited(socketSubscription.cancel());
    }
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
    final socketSubscription = _socketSubscription;
    _socketSubscription = null;
    if (socketSubscription != null) {
      unawaited(socketSubscription.cancel());
    }
    _channel?.sink.close();
    _channel = null;
  }
}
