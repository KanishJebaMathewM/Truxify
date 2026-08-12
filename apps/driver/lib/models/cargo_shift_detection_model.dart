class SuspensionTelemetry {
  final double lateralGForce;
  final double leftAirbagPsi;
  final double rightAirbagPsi;
  final double weightDistributionDeltaPct;
  final String status; // "Stable", "Warning", "Critical Shift"
  final String systemMessage;

  SuspensionTelemetry({
    required this.lateralGForce,
    required this.leftAirbagPsi,
    required this.rightAirbagPsi,
    required this.weightDistributionDeltaPct,
    required this.status,
    required this.systemMessage,
  });
}
