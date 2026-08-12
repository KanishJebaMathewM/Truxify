import 'dart:async';
import '../models/hvac_apu_model.dart';

class HvacApuService {
  final _sessionController = StreamController<HvacApuSession>.broadcast();

  Stream<HvacApuSession> get hvacStream => _sessionController.stream;

  void simulateWakeCycle() async {
    DateTime alarmTime = DateTime.now().add(const Duration(minutes: 35));

    // 1. Driver asleep, APU idle, cab is cold (Winter)
    _sessionController.add(HvacApuSession(
      status: 'Sleeping (APU Idle) - Saving Battery',
      estimatedWakeTime: alarmTime,
      currentCabTempF: 45.0, // Cold
      targetCabTempF: 70.0,
      ambientTempF: 15.0, // Outside is freezing
      apu: ApuSystem(isRunning: false, batterySoc: 85.0, currentDrawKw: 0.0, activeMode: 'Idle'),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. 30 mins before alarm, APU kicks on to heat
    _sessionController.add(HvacApuSession(
      status: 'PRE-CONDITIONING: HEATING CAB',
      estimatedWakeTime: alarmTime, // Still ~30 mins
      currentCabTempF: 52.0, // Warming up
      targetCabTempF: 70.0,
      ambientTempF: 15.0,
      apu: ApuSystem(isRunning: true, batterySoc: 84.5, currentDrawKw: 3.5, activeMode: 'Heating'),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Alarm time, cab is perfectly warm
    _sessionController.add(HvacApuSession(
      status: 'TARGET TEMP REACHED - GOOD MORNING',
      estimatedWakeTime: alarmTime,
      currentCabTempF: 70.0, // Perfect
      targetCabTempF: 70.0,
      ambientTempF: 15.0,
      apu: ApuSystem(isRunning: true, batterySoc: 80.0, currentDrawKw: 0.8, activeMode: 'Maintaining'),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
