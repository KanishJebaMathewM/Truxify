class OcularTelemetry {
  final double blinkRatePerMinute;
  final double averageEyeClosureDurationMs; // Normal is ~100-150ms. Microsleep is >500ms.
  final double headNodAngleDegrees;
  final bool microsleepDetected;

  OcularTelemetry({
    required this.blinkRatePerMinute,
    required this.averageEyeClosureDurationMs,
    required this.headNodAngleDegrees,
    required this.microsleepDetected,
  });
}

class FatigueSession {
  final String driverId;
  final String status; // "Alert & Active", "Drowsiness Detected", "CRITICAL - MICROSLEEP ALARM"
  final double fatigueScore; // 0-100
  final String recommendedAction;
  final OcularTelemetry ocularData;

  FatigueSession({
    required this.driverId,
    required this.status,
    required this.fatigueScore,
    required this.recommendedAction,
    required this.ocularData,
  });
}
