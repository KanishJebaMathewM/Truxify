class ReeferTelemetry {
  final double currentTempFahrenheit;
  final double targetTempFahrenheit;
  final double compressorCycleTimeMins;
  final double freonPressurePsi;
  final double ambientTempFahrenheit;

  ReeferTelemetry({
    required this.currentTempFahrenheit,
    required this.targetTempFahrenheit,
    required this.compressorCycleTimeMins,
    required this.freonPressurePsi,
    required this.ambientTempFahrenheit,
  });
}

class ReeferAiSession {
  final String status; // "Monitoring Optimal Range", "CRITICAL PREDICTION: COMPRESSOR FAILURE IMMINENT"
  final double failureProbability; // 0-100%
  final String? systemDirective;
  final ReeferTelemetry telemetry;

  ReeferAiSession({
    required this.status,
    required this.failureProbability,
    this.systemDirective,
    required this.telemetry,
  });
}
