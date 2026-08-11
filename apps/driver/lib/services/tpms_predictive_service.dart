import 'dart:async';
import '../models/tpms_predictive_model.dart';

class TpmsPredictiveService {
  final _sessionController = StreamController<TpmsSession>.broadcast();

  Stream<TpmsSession> get tpmsStream => _sessionController.stream;

  void simulateHighwayDriving() async {
    final normalTire = TireData(
      position: 'Left Outer Drive',
      currentPsi: 105.0,
      tempFahrenheit: 110.0,
      isLeaking: false,
      pressureLossRatePerHour: 0.0,
      milesToCriticalFailure: 99999,
    );

    // 1. Normal Highway
    _sessionController.add(TpmsSession(
      status: 'Tracking Thermal Dynamics...',
      hasCriticalAlert: false,
      tires: [
        normalTire,
        TireData(
          position: 'Right Inner Trailer',
          currentPsi: 100.0,
          tempFahrenheit: 115.0,
          isLeaking: false, // Starting normal
          pressureLossRatePerHour: 0.0,
          milesToCriticalFailure: 99999,
        ),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Slow Leak Detected
    _sessionController.add(TpmsSession(
      status: 'ANALYZING PRESSURE DROP...',
      hasCriticalAlert: false, // Not critical yet, just monitoring
      tires: [
        normalTire,
        TireData(
          position: 'Right Inner Trailer',
          currentPsi: 95.0,
          tempFahrenheit: 125.0, // Friction heating up
          isLeaking: true,
          pressureLossRatePerHour: 3.5,
          milesToCriticalFailure: 180, // Far away
        ),
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. Predictive Alert
    _sessionController.add(TpmsSession(
      status: 'CRITICAL FAILURE PREDICTED IN 32 MILES',
      hasCriticalAlert: true,
      tires: [
        normalTire,
        TireData(
          position: 'Right Inner Trailer',
          currentPsi: 82.0,
          tempFahrenheit: 185.0, // Very hot
          isLeaking: true,
          pressureLossRatePerHour: 12.5, // Expanding leak
          milesToCriticalFailure: 32, // Driver needs to act now
        ),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
