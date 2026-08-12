class ReeferTelemetry {
  final String trailerId;
  final double currentTempF;
  final double targetTempF;
  final String status; // "Idle", "Pre-cooling Active", "Ready - Target Achieved"
  final int timeToTargetMinutes;

  ReeferTelemetry({
    required this.trailerId,
    required this.currentTempF,
    required this.targetTempF,
    required this.status,
    required this.timeToTargetMinutes,
  });
}

class PreCoolingSession {
  final String shipperName;
  final int etaMinutes;
  final bool autoSyncEnabled;
  final ReeferTelemetry telemetry;

  PreCoolingSession({
    required this.shipperName,
    required this.etaMinutes,
    required this.autoSyncEnabled,
    required this.telemetry,
  });
}
