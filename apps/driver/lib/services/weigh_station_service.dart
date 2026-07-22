import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import '../core/api_client.dart';
import 'location_service.dart';

class WeighStationEvent {
  final String action; // 'BYPASS' or 'PULL_IN'
  final String reason;
  final String stationId;

  WeighStationEvent({
    required this.action,
    required this.reason,
    required this.stationId,
  });
}

class WeighStationService {
  WeighStationService._privateConstructor();
  static final WeighStationService instance = WeighStationService._privateConstructor();

  final ApiClient _apiClient = ApiClient();
  final _eventController = StreamController<WeighStationEvent>.broadcast();
  StreamSubscription<Position>? _locationSub;

  Stream<WeighStationEvent> get eventStream => _eventController.stream;

  // Mock Weigh Station Coordinates for demo (e.g. major highways)
  // Distance threshold: 2 miles = ~3218 meters
  static const double _alertThresholdMeters = 3218.0;

  final List<Map<String, double>> _mockStations = [
    {'lat': 34.0522, 'lng': -118.2437}, // Los Angeles
    {'lat': 40.7128, 'lng': -74.0060},  // NY
    {'lat': 37.7749, 'lng': -122.4194}, // SF
    {'lat': 29.7604, 'lng': -95.3698},  // Houston
  ];

  final Set<String> _alertedStations = {};
  bool _isChecking = false;
  Position? _lastPos;

  void initialize() {
    _startLocationListener();
  }

  void _startLocationListener() {
    _locationSub?.cancel();
    
    // We listen to the same Geolocator stream to avoid waking GPS independently
    _locationSub = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 100, // Check every 100 meters
      ),
    ).listen((pos) {
      _checkProximity(pos);
    });
  }

  void forceDemoProximity() {
    // A helper method for demo purposes to force a trigger
    if (_lastPos != null) {
      _mockStations.add({
        'lat': _lastPos!.latitude + 0.01,
        'lng': _lastPos!.longitude + 0.01
      });
      _checkProximity(_lastPos!);
    }
  }

  Future<void> _checkProximity(Position pos) async {
    _lastPos = pos;
    if (_isChecking) return;
    _isChecking = true;

    try {
      for (int i = 0; i < _mockStations.length; i++) {
        final station = _mockStations[i];
        final stationKey = 'station_$i';
        
        if (_alertedStations.contains(stationKey)) continue;

        final distance = Geolocator.distanceBetween(
          pos.latitude, pos.longitude,
          station['lat']!, station['lng']!,
        );

        if (distance <= _alertThresholdMeters) {
          _alertedStations.add(stationKey);
          await _triggerBypassCheck(stationKey, pos);
          break; // Only alert one at a time
        }
      }
    } finally {
      _isChecking = false;
    }
  }

  Future<void> _triggerBypassCheck(String stationKey, Position pos) async {
    try {
      final response = await _apiClient.get(
        '/api/driver/weigh-stations/bypass-status?lat=${pos.latitude}&lng=${pos.longitude}'
      );

      final event = WeighStationEvent(
        action: response['action'] ?? 'PULL_IN',
        reason: response['reason'] ?? 'Random check',
        stationId: response['stationId'] ?? stationKey,
      );

      _eventController.add(event);
    } catch (e) {
      debugPrint('[WeighStationService] Error checking bypass status: $e');
    }
  }

  void dispose() {
    _locationSub?.cancel();
    _eventController.close();
  }
}
