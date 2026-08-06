import 'dart:async';
import '../models/reefer_temperature_model.dart';

class ReeferAnomalyService {
  /// Simulates an ML model analyzing telemetry data to predict temperature failures
  Stream<List<ReeferZone>> monitorZones() async* {
    yield [
      ReeferZone(
        zoneId: 'Zone 1 (Front/Frozen)',
        currentTempF: -10.5,
        targetTempF: -10.0,
        ambientExternalTempF: 95.0,
        compressorCycleCount: 4,
        doorsOpen: false,
        anomalyProbability: 0.05,
        estimatedMinutesToFailure: 999, // Safe
      ),
      ReeferZone(
        zoneId: 'Zone 2 (Rear/Chilled)',
        currentTempF: 34.2,
        targetTempF: 34.0,
        ambientExternalTempF: 95.0,
        compressorCycleCount: 12,
        doorsOpen: true, // Dock worker left door open
        anomalyProbability: 0.85, // High risk of failure soon
        estimatedMinutesToFailure: 18,
      )
    ];

    await Future.delayed(const Duration(seconds: 4));

    yield [
      ReeferZone(
        zoneId: 'Zone 1 (Front/Frozen)',
        currentTempF: -9.8,
        targetTempF: -10.0,
        ambientExternalTempF: 95.0,
        compressorCycleCount: 5,
        doorsOpen: false,
        anomalyProbability: 0.10,
        estimatedMinutesToFailure: 999,
      ),
      ReeferZone(
        zoneId: 'Zone 2 (Rear/Chilled)',
        currentTempF: 36.8, // Temperature rising rapidly
        targetTempF: 34.0,
        ambientExternalTempF: 95.0,
        compressorCycleCount: 15, // Compressor working overtime
        doorsOpen: true, 
        anomalyProbability: 0.98, // Critical prediction
        estimatedMinutesToFailure: 4, // Will spoil in 4 mins
      )
    ];
  }
}
