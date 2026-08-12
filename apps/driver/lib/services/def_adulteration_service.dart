import 'dart:async';
import '../models/def_adulteration_model.dart';

class DefAdulterationService {
  final _sessionController = StreamController<DefSession>.broadcast();

  Stream<DefSession> get defStream => _sessionController.stream;

  void simulateRefueling() async {
    // 1. Idle
    _sessionController.add(DefSession(
      status: 'Intake Valve Open - Awaiting Fluid',
      isIntakeValveLocked: false,
      isAnalyzing: false,
      currentSample: DefSample(ureaConcentration: 32.5, waterContent: 67.5, mineralContamination: 0.0),
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Pumping starts, analyzing
    _sessionController.add(DefSession(
      status: 'ULTRASONIC SENSOR ANALYZING FLUID...',
      isIntakeValveLocked: false,
      isAnalyzing: true,
      currentSample: DefSample(ureaConcentration: 28.0, waterContent: 71.0, mineralContamination: 1.0),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Bad DEF detected, locking valve
    _sessionController.add(DefSession(
      status: 'ADULTERATED DEF DETECTED: INTAKE LOCKED',
      isIntakeValveLocked: true,
      isAnalyzing: false,
      currentSample: DefSample(ureaConcentration: 24.5, waterContent: 73.0, mineralContamination: 2.5), // High water, low urea, minerals present
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
