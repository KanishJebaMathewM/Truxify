class ThermalSignature {
  final String objectClass; // "Moose", "Deer", "Unknown Mammal"
  final double distanceFeet;
  final double trajectoryAngle; // Is it running towards the road?
  final double confidenceScore; // 0.0 to 1.0

  ThermalSignature({
    required this.objectClass,
    required this.distanceFeet,
    required this.trajectoryAngle,
    required this.confidenceScore,
  });
}

class WildlifeArSession {
  final String status; // "FLIR Active - No Threats", "LARGE MAMMAL DETECTED"
  final double vehicleSpeedMph;
  final bool isNightMode;
  final bool isBrakingSuggested;
  final List<ThermalSignature> activeSignatures;

  WildlifeArSession({
    required this.status,
    required this.vehicleSpeedMph,
    required this.isNightMode,
    required this.isBrakingSuggested,
    required this.activeSignatures,
  });
}
