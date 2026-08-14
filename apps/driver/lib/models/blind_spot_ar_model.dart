class DetectedVehicle {
  final String vehicleId;
  final String type; // "Sedan", "Motorcycle"
  final String locationZone; // "Right Blind Spot", "Rear Tailgate"
  final double distanceFeet;
  final double relativeSpeedMph;
  final bool isHazard;

  DetectedVehicle({
    required this.vehicleId,
    required this.type,
    required this.locationZone,
    required this.distanceFeet,
    required this.relativeSpeedMph,
    required this.isHazard,
  });
}

class BlindSpotSession {
  final String status; // "360° AR Stitching Active", "COLLISION WARNING: RIGHT BLIND SPOT"
  final bool turnSignalActive;
  final String? activeWarningZone; // null or "Right", "Left", "Rear"
  final List<DetectedVehicle> detectedVehicles;

  BlindSpotSession({
    required this.status,
    required this.turnSignalActive,
    this.activeWarningZone,
    required this.detectedVehicles,
  });
}
