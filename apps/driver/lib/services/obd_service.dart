import 'dart:async';
import 'dart:math';
import '../models/obd_telemetry_model.dart';

class ObdService {
  bool _hasRecentFuelingEvent = false;
  double _lastDefUreaConcentration = 32.5;

  // Simulates a Bluetooth OBD-II connection stream
  Stream<ObdTelemetry> getTelemetryStream() async* {
    final random = Random();
    int tickCount = 0;
    while (true) {
      await Future.delayed(const Duration(seconds: 2));
      tickCount++;
      
      // Simulate slightly fluctuating data
      double temp = 190.0 + random.nextDouble() * 20; // 190-210 F is normal
      double oil = 85.0 + random.nextDouble() * 10;
      double pressure = 100.0 + random.nextDouble() * 5;
      double health = 90.0 + random.nextDouble() * 10;
      double nox = 10.0 + random.nextDouble() * 5;
      double urea = _lastDefUreaConcentration;
      
      List<String> activeWarnings = [];

      // Simulate fueling event
      if (tickCount == 3) {
        _hasRecentFuelingEvent = true;
      }
      
      // Simulate sudden drop in urea if recent fueling event
      if (_hasRecentFuelingEvent && tickCount == 5) {
        urea = 18.0; // Dropped drastically due to contamination
      }

      if (urea < 30.0 && _hasRecentFuelingEvent) {
         activeWarnings.add('CRITICAL: DEF Contamination Detected! Shut off engine immediately to prevent SCR catalyst destruction.');
         health -= 50;
      }

      if (temp > 205) {
        activeWarnings.add('High Engine Temperature Warning. Predictive failure in 500 miles.');
        health -= 15;
      }

      _lastDefUreaConcentration = urea;

      yield ObdTelemetry(
        engineTemperature: temp,
        oilLevel: oil,
        tirePressureAvg: pressure,
        predictiveHealthScore: health,
        defUreaConcentration: urea,
        noxLevel: nox,
        warnings: activeWarnings,
      );
    }
  }
}
