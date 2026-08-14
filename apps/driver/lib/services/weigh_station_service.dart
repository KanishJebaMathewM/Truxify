import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:truxify_shared/src/services/api_client.dart';
import 'location_service.dart';

class WeighStationEvent {
  final String action; // 'BYPASS', 'PULL_IN' or 'UNSUPPORTED'
  final String reason;
  final String stationId;
  final bool simulated;

  WeighStationEvent({
    required this.action,
    required this.reason,
    required this.stationId,
    this.simulated = false,
  });
}

class WeighStationService {
  WeighStationService._({String? apiBaseUrl}) : _apiClient = ApiClient(baseUrl: apiBaseUrl);

  static final WeighStationService instance = WeighStationService._();

  final ApiClient _apiClient;
  final _eventController = StreamController<WeighStationEvent>.broadcast();
  StreamSubscription<Position>? _locationSub;

  Stream<WeighStationEvent> get eventStream => _eventController.stream;

  // Mock Weigh Station Coordinates for demo (e.g. major highways)
  // Distance threshold: 2 miles = ~3218 meters
  static const double _alertThresholdMeters = 3218.0;

  final List<Map<String, double>> _mockStations = [
    {'lat': 28.6139, 'lng': 77.2090},   // Delhi
    {'lat': 19.0760, 'lng': 72.8777},   // Mumbai
    {'lat': 12.9716, 'lng': 77.5946},   // Bangalore
    {'lat': 22.5726, 'lng': 88.3639},   // Kolkata
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

      if (response is Map<String, dynamic> && _isUnsupported(response)) {
        _emitEvent(_unsupportedEvent(response));
        return;
      }

      _emitEvent(WeighStationEvent(
        action: response['action'] ?? 'PULL_IN',
        reason: response['reason'] ?? 'Random check',
        stationId: response['stationId'] ?? stationKey,
      ));
    } catch (e) {
      // The endpoint fails closed with 503 UNSUPPORTED until a real WIM
      // provider is integrated. Surface that as a clearly-simulated preview;
      // never show an authoritative BYPASS/PULL_IN verdict on a failure.
      if (e is ApiException && e.body != null) {
        try {
          final decoded = jsonDecode(e.body!);
          if (decoded is Map<String, dynamic> && _isUnsupported(decoded)) {
            _emitEvent(_unsupportedEvent(decoded));
            return;
          }
        } catch (_) {
          // Not JSON — fall through to the generic debug log below.
        }
      }
      debugPrint('[WeighStationService] Error checking bypass status: $e');
    }
  }

  bool _isUnsupported(Map<String, dynamic> payload) =>
      payload['supported'] == false || payload['action'] == 'UNSUPPORTED';

  WeighStationEvent _unsupportedEvent(Map<String, dynamic> payload) =>
      WeighStationEvent(
        action: 'UNSUPPORTED',
        reason: (payload['reason'] as String?) ??
            'Weigh-in-motion bypass is not available.',
        stationId: 'N/A',
        simulated: true,
      );

  void _emitEvent(WeighStationEvent event) {
    if (!_eventController.isClosed) {
      _eventController.add(event);
    }
  }

  void resetAlertedStations() {
    _alertedStations.clear();
  }

  void dispose() {
    _locationSub?.cancel();
    _eventController.close();
  }
}
