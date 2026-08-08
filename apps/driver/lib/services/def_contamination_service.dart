import 'dart:async';
import '../models/def_contamination_model.dart';

class DefContaminationService {
  final _sensorController = StreamController<DefSensorReading>.broadcast();

  Stream<DefSensorReading> get sensorStream => _sensorController.stream;

  void simulateContaminationEvent() async {
    // 1. Normal Operation
    _sensorController.add(DefSensorReading(
      ureaConcentrationPct: 32.5,
      tankTemperatureF: 85.0,
      noxReductionEfficiencyPct: 98.2,
      status: 'Optimal',
      systemMessage: 'DEF Quality Verified. SCR Catalyst operating normally.',
      isEngineKillRequired: false,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Driver fills up with bad DEF at a truck stop (Urea drops drastically)
    _sensorController.add(DefSensorReading(
      ureaConcentrationPct: 15.0, // Watered down or contaminated
      tankTemperatureF: 82.0,
      noxReductionEfficiencyPct: 80.0, // Dropping fast
      status: 'Warning',
      systemMessage: 'Sudden drop in urea concentration detected. Verifying sensor data...',
      isEngineKillRequired: false,
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 3. Imminent Danger - Shut off engine before it reaches SCR
    _sensorController.add(DefSensorReading(
      ureaConcentrationPct: 12.1,
      tankTemperatureF: 81.5,
      noxReductionEfficiencyPct: 45.0, // SCR failing
      status: 'Critical - Shut Down',
      systemMessage: 'CONTAMINATED DEF DETECTED! Shut off engine IMMEDIATELY to prevent catastrophic SCR destruction.',
      isEngineKillRequired: true,
    ));
  }

  void dispose() {
    _sensorController.close();
  }
}
