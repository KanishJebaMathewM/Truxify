import 'dart:async';
import '../models/tire_chain_model.dart';

class TireChainService {
  final _sessionController = StreamController<TireChainSession>.broadcast();

  Stream<TireChainSession> get chainStream => _sessionController.stream;

  void simulateBlizzardDeployment() async {
    // 1. Nominal cold weather
    _sessionController.add(TireChainSession(
      status: 'System Standby - Monitoring Traction',
      isHazardActive: false,
      roadGrade: 2.0,
      wheelSlipPercentage: 0.0,
      ambientTempF: 15.0,
      vehicleSpeedMph: 45.0,
      chainSystem: PneumaticChainSystem(isDeployed: false, airPressurePsi: 120.0, currentRpm: 0.0),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Steep grade + slip detected
    _sessionController.add(TireChainSession(
      status: 'CRITICAL: TRACTION LOSS ON 8% GRADE',
      isHazardActive: true,
      roadGrade: 8.5,
      wheelSlipPercentage: 15.0, // Slipping
      ambientTempF: 12.0,
      vehicleSpeedMph: 25.0, // Slowing down
      chainSystem: PneumaticChainSystem(isDeployed: false, airPressurePsi: 120.0, currentRpm: 0.0),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Deployed
    _sessionController.add(TireChainSession(
      status: 'PNEUMATIC CHAINS DEPLOYED - TRACTION REGAINED',
      isHazardActive: true,
      roadGrade: 8.5,
      wheelSlipPercentage: 2.0, // Fixed
      ambientTempF: 12.0,
      vehicleSpeedMph: 20.0, // Safe speed
      chainSystem: PneumaticChainSystem(isDeployed: true, airPressurePsi: 110.0, currentRpm: 250.0), // Chains spinning
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
