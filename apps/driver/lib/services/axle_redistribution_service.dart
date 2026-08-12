import 'dart:async';
import '../models/axle_redistribution_model.dart';

class AxleRedistributionService {
  final _sessionController = StreamController<RedistributionSession>.broadcast();

  Stream<RedistributionSession> get redistributionStream => _sessionController.stream;

  void simulateAirSuspensionAdjustment() async {
    // 1. Initial State (Overweight on drives)
    _sessionController.add(RedistributionSession(
      status: 'OVERWEIGHT DETECTED ON DRIVE AXLES',
      isAdjusting: false,
      currentWeights: AxleWeights(
        steerLbs: 11500,
        driveLbs: 35200, // OVER (Max 34k)
        tandemLbs: 32100, // Under
      ),
      targetPsiAdjustment: 0.0,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Adjusting Pneumatics
    _sessionController.add(RedistributionSession(
      status: 'Increasing Airbag PSI on Trailer Tandems...',
      isAdjusting: true,
      currentWeights: AxleWeights(
        steerLbs: 11500,
        driveLbs: 34500, // Shifting...
        tandemLbs: 32800, // Shifting...
      ),
      targetPsiAdjustment: +14.5,
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Balanced
    _sessionController.add(RedistributionSession(
      status: 'LOAD BALANCED & DOT LEGAL',
      isAdjusting: false,
      currentWeights: AxleWeights(
        steerLbs: 11500,
        driveLbs: 33800, // LEGAL
        tandemLbs: 33500, // LEGAL
      ),
      targetPsiAdjustment: 0.0,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
