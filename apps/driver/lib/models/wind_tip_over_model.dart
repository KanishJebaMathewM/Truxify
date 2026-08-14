class WeatherTelemetry {
  final double currentWindSpeedMph;
  final double maxGustSpeedMph;
  final double crosswindAngleDegrees; // Angle relative to truck heading

  WeatherTelemetry({
    required this.currentWindSpeedMph,
    required this.maxGustSpeedMph,
    required this.crosswindAngleDegrees,
  });
}

class WindRiskSession {
  final int truckGrossWeightLbs;
  final String status; // "Monitoring Conditions", "CRITICAL RISK - BLOWOVER IMMINENT"
  final double tipOverRiskScore; // 0-100
  final WeatherTelemetry weatherData;
  final String systemDirective;

  WindRiskSession({
    required this.truckGrossWeightLbs,
    required this.status,
    required this.tipOverRiskScore,
    required this.weatherData,
    required this.systemDirective,
  });
}
