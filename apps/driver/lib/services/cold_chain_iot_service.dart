import 'dart:async';
import 'dart:math';
import '../models/reefer_temperature_model.dart';

class ColdChainIotService {
  /// Simulates connecting to a Bluetooth or Cellular IoT temperature sensor
  /// installed inside a refrigerated trailer (reefer).
  Stream<ReeferTemperature> streamTemperatureData(String trailerId) async* {
    final random = Random();
    
    // Initial safe state for vaccines/pharmaceuticals (requires 2.0 to 8.0 Celsius)
    double currentTemp = 4.0; 

    while (true) {
      await Future.delayed(const Duration(seconds: 2));
      
      // Simulate temperature fluctuations
      // There's a 10% chance the cooling unit starts failing, pushing temps up
      bool unitFailing = random.nextDouble() > 0.90;
      
      if (unitFailing) {
        currentTemp += random.nextDouble() * 1.5; // rapid increase
      } else {
        currentTemp += (random.nextDouble() - 0.5) * 0.5; // normal slight fluctuation
      }

      yield ReeferTemperature(
        trailerId: trailerId,
        currentTempCelsius: currentTemp,
        humidityPercentage: 45.0 + random.nextDouble() * 5.0,
        safeTempMin: 2.0,
        safeTempMax: 8.0,
        timestamp: DateTime.now(),
      );
    }
  }
}
