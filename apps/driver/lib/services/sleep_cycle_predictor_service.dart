import 'dart:async';
import '../models/driver_fatigue_model.dart';

class SleepCyclePredictorService {
  /// Simulates syncing with a wearable device (like a Garmin or Apple Watch)
  /// to analyze sleep cycles and heart rate against active Hours of Service.
  Stream<DriverFatigueProfile> monitorFatigueLevels() async* {
    // Initial state: Driver just woke up, legally and physically safe
    yield DriverFatigueProfile(
      driverId: 'DRV-88992',
      currentFatigueScore: 12.0,
      totalSleepMinutesLast24h: 420, // 7 hours
      sleepQuality: 'GOOD',
      averageHeartRateBpm: 65,
      isLegallyAllowedToDrive: true,
      isPhysicallySafeToDrive: true,
    );

    await Future.delayed(const Duration(seconds: 4));

    // Simulated state: End of a long shift, driver is legally compliant but physically exhausted
    yield DriverFatigueProfile(
      driverId: 'DRV-88992',
      currentFatigueScore: 88.5,
      totalSleepMinutesLast24h: 300, // Only 5 hours of sleep the night before
      sleepQuality: 'POOR',
      averageHeartRateBpm: 88, // Elevated due to stress/fatigue
      isLegallyAllowedToDrive: true, // Still has 1 hour of HoS left
      isPhysicallySafeToDrive: false, // AI flags as critical risk of micro-sleep
    );
  }
}
