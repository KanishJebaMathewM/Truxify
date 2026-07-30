import 'dart:async';
import 'dart:math';
import '../models/obd_telemetry_model.dart';

class ObdService {
  // Simulates a Bluetooth OBD-II connection stream
  Stream<ObdTelemetry> getTelemetryStream() async* {
    final random = Random();
    while (true) {
      await Future.delayed(const Duration(seconds: 2));
      
      // Simulate slightly fluctuating data
      double temp = 190.0 + random.nextDouble() * 20; // 190-210 F is normal
      double oil = 85.0 + random.nextDouble() * 10;
      double pressure = 100.0 + random.nextDouble() * 5;
      double health = 90.0 + random.nextDouble() * 10;
      
      List<String> activeWarnings = [];
      if (temp > 205) {
        activeWarnings.add('High Engine Temperature Warning. Predictive failure in 500 miles.');
        health -= 15;
      }

      yield ObdTelemetry(
        engineTemperature: temp,
        oilLevel: oil,
        tirePressureAvg: pressure,
        predictiveHealthScore: health,
        warnings: activeWarnings,
      );
    }
  }
}
