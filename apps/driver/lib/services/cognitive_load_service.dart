import 'dart:async';
import '../models/cognitive_load_model.dart';

class CognitiveLoadService {
  final _sessionController = StreamController<CognitiveLoadSession>.broadcast();

  Stream<CognitiveLoadSession> get loadStream => _sessionController.stream;

  void simulateDrivingEnvironment() async {
    // 1. Normal Highway Driving
    _sessionController.add(CognitiveLoadSession(
      status: 'Open Highway (Normal Load)',
      isHighStressActive: false,
      trafficDensity: 'Low',
      weatherCondition: 'Clear',
      suppressedCount: 0,
      queuedItems: [],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Entering Chicago + Rain
    _sessionController.add(CognitiveLoadSession(
      status: 'HIGH COGNITIVE LOAD DETECTED',
      isHighStressActive: true,
      trafficDensity: 'Heavy (Stop & Go)',
      weatherCondition: 'Heavy Rain',
      suppressedCount: 0,
      queuedItems: [],
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. Notifications Suppressed
    _sessionController.add(CognitiveLoadSession(
      status: 'SILENCING NON-CRITICAL ALERTS',
      isHighStressActive: true,
      trafficDensity: 'Heavy (Stop & Go)',
      weatherCondition: 'Heavy Rain',
      suppressedCount: 3,
      queuedItems: [
        QueuedNotification(
          id: 'N1',
          source: 'Dispatch',
          title: 'Text: "Can you make it early tomorrow?"',
          priority: 'Low',
        ),
        QueuedNotification(
          id: 'N2',
          source: 'Telematics',
          title: 'Low Windshield Washer Fluid',
          priority: 'Low',
        ),
        QueuedNotification(
          id: 'N3',
          source: 'System',
          title: 'App Update Available (v2.4)',
          priority: 'Low',
        ),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
