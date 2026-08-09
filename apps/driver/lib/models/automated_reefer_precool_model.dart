class ReeferTelemetry {
  final double currentInternalTempF;
  final double targetLoadTempF;
  final double ambientOutsideTempF;
  final String coolingMode; // "Off", "Idle", "Aggressive Pre-cool"
  final double estimatedTimeToTargetMinutes;
  final bool isReadyForPickup;

  ReeferTelemetry({
    required this.currentInternalTempF,
    required this.targetLoadTempF,
    required this.ambientOutsideTempF,
    required this.coolingMode,
    required this.estimatedTimeToTargetMinutes,
    required this.isReadyForPickup,
  });
}
