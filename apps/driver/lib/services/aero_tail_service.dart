import 'dart:async';
import '../models/aero_tail_model.dart';

class AeroTailService {
  final _sessionController = StreamController<AeroTailSession>.broadcast();

  Stream<AeroTailSession> get tailStream => _sessionController.stream;

  void simulateHighwayEntry() async {
    // 1. Low speed, folded
    _sessionController.add(AeroTailSession(
      status: 'Low Speed: Tails Folded',
      vehicleSpeedMph: 25.0,
      dragReductionPercent: 0.0,
      foils: [
        MotorizedFoil(location: 'Left Panel', isDeployed: false, actuatorPositionPercent: 0.0, status: 'Nominal'),
        MotorizedFoil(location: 'Top Panel', isDeployed: false, actuatorPositionPercent: 0.0, status: 'Nominal'),
        MotorizedFoil(location: 'Right Panel', isDeployed: false, actuatorPositionPercent: 0.0, status: 'Nominal'),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Accelerating past 50 mph, deploying
    _sessionController.add(AeroTailSession(
      status: 'HIGH SPEED DETECTED: DEPLOYING FOILS...',
      vehicleSpeedMph: 55.0,
      dragReductionPercent: 2.5,
      foils: [
        MotorizedFoil(location: 'Left Panel', isDeployed: false, actuatorPositionPercent: 50.0, status: 'Actuating'),
        MotorizedFoil(location: 'Top Panel', isDeployed: false, actuatorPositionPercent: 50.0, status: 'Actuating'),
        MotorizedFoil(location: 'Right Panel', isDeployed: false, actuatorPositionPercent: 50.0, status: 'Actuating'),
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Fully Deployed
    _sessionController.add(AeroTailSession(
      status: 'MAXIMUM AERODYNAMIC EFFICIENCY',
      vehicleSpeedMph: 65.0,
      dragReductionPercent: 6.8, // Saving almost 7% fuel
      foils: [
        MotorizedFoil(location: 'Left Panel', isDeployed: true, actuatorPositionPercent: 100.0, status: 'Nominal'),
        MotorizedFoil(location: 'Top Panel', isDeployed: true, actuatorPositionPercent: 100.0, status: 'Nominal'),
        MotorizedFoil(location: 'Right Panel', isDeployed: true, actuatorPositionPercent: 100.0, status: 'Nominal'),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
