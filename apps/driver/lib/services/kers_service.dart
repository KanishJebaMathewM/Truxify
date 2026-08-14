import 'dart:async';
import '../models/kers_model.dart';

class KersService {
  final _sessionController = StreamController<KersSession>.broadcast();

  Stream<KersSession> get kersStream => _sessionController.stream;

  void simulateMountainDescent() async {
    // 1. Coasting on flat ground
    _sessionController.add(KersSession(
      status: 'Awaiting Topography Change...',
      isRegenActive: false,
      isFrictionWarning: false,
      gradePercentage: 0.0,
      telemetry: EnergyState(
        regenPowerKw: 0.0,
        frictionBrakeTempF: 150.0,
        batteryChargePercent: 45.0,
      ),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Starting descent, bad braking
    _sessionController.add(KersSession(
      status: 'WARNING: EXCESSIVE FRICTION BRAKING',
      isRegenActive: true,
      isFrictionWarning: true,
      gradePercentage: -6.0, // 6% downgrade
      telemetry: EnergyState(
        regenPowerKw: 50.0, // Low regen
        frictionBrakeTempF: 450.0, // Heating up fast
        batteryChargePercent: 46.0,
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Driver corrects - optimal regen
    _sessionController.add(KersSession(
      status: 'OPTIMAL KINETIC HARVESTING',
      isRegenActive: true,
      isFrictionWarning: false,
      gradePercentage: -6.0,
      telemetry: EnergyState(
        regenPowerKw: 350.0, // Max regen
        frictionBrakeTempF: 380.0, // Cooling down
        batteryChargePercent: 49.0, // Charging fast
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
