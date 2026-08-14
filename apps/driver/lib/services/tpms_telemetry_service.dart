import 'dart:async';
import '../models/tpms_analytics_model.dart';

class TpmsTelemetryService {
  Stream<TruckTpmsState> streamTireData() async* {
    // Yield healthy state
    yield TruckTpmsState(
      overallStatus: 'SYSTEM NOMINAL',
      tires: [
        TireTelemetry(tirePosition: 'Steer Left', currentPressurePsi: 105, targetPressurePsi: 105, temperatureFahrenheit: 110, treadWearPredictionPct: 75, status: 'Optimal'),
        TireTelemetry(tirePosition: 'Steer Right', currentPressurePsi: 105, targetPressurePsi: 105, temperatureFahrenheit: 112, treadWearPredictionPct: 78, status: 'Optimal'),
        TireTelemetry(tirePosition: 'Drive L Outer', currentPressurePsi: 95, targetPressurePsi: 95, temperatureFahrenheit: 115, treadWearPredictionPct: 60, status: 'Optimal'),
        TireTelemetry(tirePosition: 'Drive R Outer', currentPressurePsi: 95, targetPressurePsi: 95, temperatureFahrenheit: 118, treadWearPredictionPct: 65, status: 'Optimal'),
      ]
    );

    await Future.delayed(const Duration(seconds: 4));

    // Yield warning/critical anomaly state after ML inference
    yield TruckTpmsState(
      overallStatus: 'ANOMALY DETECTED',
      tires: [
        TireTelemetry(tirePosition: 'Steer Left', currentPressurePsi: 105, targetPressurePsi: 105, temperatureFahrenheit: 110, treadWearPredictionPct: 75, status: 'Optimal'),
        TireTelemetry(tirePosition: 'Steer Right', currentPressurePsi: 105, targetPressurePsi: 105, temperatureFahrenheit: 112, treadWearPredictionPct: 78, status: 'Optimal'),
        TireTelemetry(tirePosition: 'Drive L Outer', currentPressurePsi: 95, targetPressurePsi: 95, temperatureFahrenheit: 115, treadWearPredictionPct: 60, status: 'Optimal'),
        TireTelemetry(tirePosition: 'Drive R Outer', currentPressurePsi: 72, targetPressurePsi: 95, temperatureFahrenheit: 165, treadWearPredictionPct: 95, status: 'Critical'), // Rapid deflation + heat
      ]
    );
  }
}
