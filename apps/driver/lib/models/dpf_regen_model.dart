class DpfTelemetry {
  final double sootLoadPercentage;
  final double exhaustTempFahrenheit;
  final double engineLoadPercentage;

  DpfTelemetry({
    required this.sootLoadPercentage,
    required this.exhaustTempFahrenheit,
    required this.engineLoadPercentage,
  });
}

class DpfRegenSession {
  final String status; // "Soot Level Nominal", "Scheduling Overnight Regen", "ACTIVE REGEN - HIGH IDLE"
  final DateTime? predictedRegenTime;
  final bool isRegenActive;
  final int estimatedMinutesRemaining;
  final DpfTelemetry telemetry;

  DpfRegenSession({
    required this.status,
    this.predictedRegenTime,
    required this.isRegenActive,
    required this.estimatedMinutesRemaining,
    required this.telemetry,
  });
}
