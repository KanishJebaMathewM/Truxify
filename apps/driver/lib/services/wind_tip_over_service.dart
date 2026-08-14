import 'dart:async';
import '../models/wind_tip_over_model.dart';

class WindTipOverService {
  final _sessionController = StreamController<WindRiskSession>.broadcast();

  Stream<WindRiskSession> get riskStream => _sessionController.stream;

  void simulateWindRisk() async {
    final emptyWeight = 34000; // Empty trailer = high risk

    // 1. Moderate wind, empty trailer
    _sessionController.add(WindRiskSession(
      truckGrossWeightLbs: emptyWeight,
      status: 'Monitoring Aerodynamic Forces...',
      tipOverRiskScore: 35.0,
      weatherData: WeatherTelemetry(
        currentWindSpeedMph: 20.0,
        maxGustSpeedMph: 28.0,
        crosswindAngleDegrees: 45.0,
      ),
      systemDirective: 'Reduce speed. High wind warnings in area.',
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. High crosswind spike
    _sessionController.add(WindRiskSession(
      truckGrossWeightLbs: emptyWeight,
      status: 'HIGH RISK: SEVERE CROSSWINDS',
      tipOverRiskScore: 78.0,
      weatherData: WeatherTelemetry(
        currentWindSpeedMph: 45.0,
        maxGustSpeedMph: 58.0,
        crosswindAngleDegrees: 85.0, // Almost perpendicular
      ),
      systemDirective: 'DANGER: Trailer is empty. High risk of blowover at current wind angles.',
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Imminent blowover risk
    _sessionController.add(WindRiskSession(
      truckGrossWeightLbs: emptyWeight,
      status: 'CRITICAL RISK: BLOWOVER IMMINENT',
      tipOverRiskScore: 98.0,
      weatherData: WeatherTelemetry(
        currentWindSpeedMph: 55.0,
        maxGustSpeedMph: 72.0, // 70+ mph gusts
        crosswindAngleDegrees: 90.0, // Direct broadside hit
      ),
      systemDirective: 'PULL OVER IMMEDIATELY. SEEK SHELTER UNDER NEAREST OVERPASS.',
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
