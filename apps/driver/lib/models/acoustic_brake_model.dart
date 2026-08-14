class WheelBrakeStatus {
  final String position; // "Steer Left", "Drive Axle 1 Right", "Trailer Axle 2 Left"
  final double estimatedThicknessMm;
  final String acousticSignature; // "Nominal Friction", "High-Pitch Squeal Detected"
  final String healthStatus; // "Healthy", "Warning", "Critical"

  WheelBrakeStatus({
    required this.position,
    required this.estimatedThicknessMm,
    required this.acousticSignature,
    required this.healthStatus,
  });
}

class AcousticBrakeSession {
  final String status; // "Listening to Braking Event...", "Diagnostic Complete"
  final double currentSpeedMph;
  final bool isBraking;
  final double averageThicknessMm;
  final List<WheelBrakeStatus> wheelStatuses;

  AcousticBrakeSession({
    required this.status,
    required this.currentSpeedMph,
    required this.isBraking,
    required this.averageThicknessMm,
    required this.wheelStatuses,
  });
}
