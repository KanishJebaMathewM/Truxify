import 'dart:async';
import '../models/battery_health_model.dart';

class BatteryAnalyticsService {
  Future<List<BatteryHealth>> getFleetBatteryStatus() async {
    await Future.delayed(const Duration(seconds: 1));

    return [
      BatteryHealth(
        truckId: 'TRK-901',
        currentVoltage: 12.6,
        crankingVoltageDrop: 1.2,
        alternatorOutput: 14.2,
        ambientTemp: 72,
        daysToFailurePrediction: 120,
        status: 'Healthy',
      ),
      BatteryHealth(
        truckId: 'TRK-442',
        currentVoltage: 12.1,
        crankingVoltageDrop: 2.5,
        alternatorOutput: 13.8,
        ambientTemp: 35,
        daysToFailurePrediction: 14,
        status: 'Warning',
      ),
      BatteryHealth(
        truckId: 'TRK-812',
        currentVoltage: 11.8,
        crankingVoltageDrop: 3.8,
        alternatorOutput: 13.5,
        ambientTemp: 22,
        daysToFailurePrediction: 2,
        status: 'Critical',
      ),
    ];
  }
}
