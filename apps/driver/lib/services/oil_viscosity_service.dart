import 'dart:async';
import '../models/oil_viscosity_model.dart';

class OilViscosityService {
  final _sessionController = StreamController<OilSession>.broadcast();

  Stream<OilSession> get fluidStream => _sessionController.stream;

  void simulateHeavyHauling() async {
    // 1. Optimal Baseline
    _sessionController.add(OilSession(
      status: 'Fluid Lubricity Optimal',
      isServiceRequired: false,
      currentMilesSinceChange: 32000,
      recommendedServiceMiles: 50000, // Standard schedule
      telemetry: FluidAnalysis(
        dielectricConstant: 2.1,
        viscosityIndex: 140.0,
        sootContaminationPercent: 1.2,
        tempFahrenheit: 210.0,
      ),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Heavy hauling up a mountain begins to sheer the oil
    _sessionController.add(OilSession(
      status: 'Analyzing Thermal Sheer...',
      isServiceRequired: false,
      currentMilesSinceChange: 38000,
      recommendedServiceMiles: 45000, // AI shortens the schedule
      telemetry: FluidAnalysis(
        dielectricConstant: 2.8,
        viscosityIndex: 125.0,
        sootContaminationPercent: 2.8,
        tempFahrenheit: 235.0,
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Viscosity Breakdown - Service required immediately
    _sessionController.add(OilSession(
      status: 'VISCOSITY BREAKDOWN: SCHEDULE SERVICE',
      isServiceRequired: true,
      currentMilesSinceChange: 41000,
      recommendedServiceMiles: 41000, // Do it now
      telemetry: FluidAnalysis(
        dielectricConstant: 4.5, // High acidity/wear metals
        viscosityIndex: 95.0, // Dangerous sheer thinning
        sootContaminationPercent: 5.1, // High soot
        tempFahrenheit: 245.0,
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
