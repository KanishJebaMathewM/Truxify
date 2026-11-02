// apps/driver/lib/services/telematics_service.dart

import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:sensors_plus/sensors_plus.dart';

class EdgeTelematicsService {
  bool _isMonitoring = false;
  StreamSubscription<AccelerometerEvent>? _accelerometerSub;
  
  // Rolling safety score metrics
  double _currentFatigueScore = 100.0;
  int _harshBrakingEvents = 0;

  void startMonitoring() {
    if (_isMonitoring) return;
    _isMonitoring = true;

    debugPrint('Starting on-device edge telematics and sensor fusion...');

    // Subscribe to accelerometer for harsh braking detection
    _accelerometerSub = accelerometerEvents.listen((event) {
      // Threshold check for harsh deceleration on Z/Y axes
      if (event.z < -4.5) {
        _harshBrakingEvents++;
        _updateSafetyScore(-5.0);
      }
    });
  }

  void _updateSafetyScore(double delta) {
    _currentFatigueScore = (_currentFatigueScore + delta).clamp(0.0, 100.0);
    debugPrint('Anonymized safety score updated: $_currentFatigueScore');
  }

  Map<String, dynamic> getAnonymizedTelemetryPayload() {
    return {
      'timestamp': DateTime.now().toIso8601String(),
      'safety_score': _currentFatigueScore,
      'harsh_braking_count': _harshBrakingEvents,
      'perclos_status': _currentFatigueScore < 70 ? 'fatigued' : 'normal'
    };
  }

  void stopMonitoring() {
    _isMonitoring = false;
    _accelerometerSub?.cancel();
    debugPrint('Stopped edge telematics monitoring.');
  }
}
