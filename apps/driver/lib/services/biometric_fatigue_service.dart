import 'dart:async';
import '../models/biometric_fatigue_model.dart';

class BiometricFatigueService {
  Stream<FatigueState> streamFatigueData() async* {
    // 1. Initial State: Alert
    yield FatigueState(
      blinkRatePerMinute: 15.0,
      headNodCount: 0.0,
      overallFatigueScorePct: 5.0,
      isCritical: false,
      recommendedAction: 'Keep Driving Safely',
    );

    await Future.delayed(const Duration(seconds: 3));

    // 2. Rising Fatigue
    yield FatigueState(
      blinkRatePerMinute: 22.0,
      headNodCount: 1.0,
      overallFatigueScorePct: 45.0,
      isCritical: false,
      recommendedAction: 'Monitor Alertness',
    );

    await Future.delayed(const Duration(seconds: 4));

    // 3. Critical Fatigue Detected
    yield FatigueState(
      blinkRatePerMinute: 35.0, // High blink rate
      headNodCount: 4.0, // Microsleeps detected
      overallFatigueScorePct: 92.0,
      isCritical: true,
      recommendedAction: 'PULL OVER IMMEDIATELY',
    );
  }

  Future<HosRoutingRecommendation> getEmergencyReroute(int currentHosMin) async {
    await Future.delayed(const Duration(seconds: 1));
    return HosRoutingRecommendation(
      locationName: 'Flying J Travel Center (Exit 12B)',
      distanceMiles: 4.2,
      detourTimeHours: 0.1,
      remainingHosMinutes: currentHosMin - 6,
    );
  }
}
