import 'dart:async';
import 'dart:math';
import '../models/weigh_in_motion_model.dart';

class WeighStationBypassService {
  /// Simulates approaching a state weigh station and transmitting credentials
  Stream<WeighInMotionEvent> simulateApproach(String state, double grossWeight) async* {
    yield WeighInMotionEvent(
      stationId: 'WS-${state.toUpperCase()}-01',
      state: state,
      currentGrossWeightLbs: grossWeight,
      legalWeightLimitLbs: 80000.0,
      isCompliant: grossWeight <= 80000.0,
      bypassStatus: 'APPROACHING',
      timestamp: DateTime.now(),
    );

    // Simulate transponder reading / PrePass network delay
    await Future.delayed(const Duration(seconds: 3));

    final random = Random();
    // 90% chance to bypass if compliant, 10% chance for random inspection
    bool randomPullIn = random.nextDouble() > 0.90;
    
    String finalStatus;
    if (grossWeight > 80000.0 || randomPullIn) {
      finalStatus = 'MUST_PULL_IN';
    } else {
      finalStatus = 'CLEARED_TO_BYPASS';
    }

    yield WeighInMotionEvent(
      stationId: 'WS-${state.toUpperCase()}-01',
      state: state,
      currentGrossWeightLbs: grossWeight,
      legalWeightLimitLbs: 80000.0,
      isCompliant: grossWeight <= 80000.0,
      bypassStatus: finalStatus,
      timestamp: DateTime.now(),
    );
  }
}
