class ThermalPoint {
  final double distanceAheadFeet;
  final double surfaceTempF;

  ThermalPoint(this.distanceAheadFeet, this.surfaceTempF);
}

class BlackIceSession {
  final String status; // "Scanning Road Surface...", "CRITICAL THERMAL DROP DETECTED"
  final bool isIceDetected;
  final double ambientTempF;
  final double recommendedSpeedMph;
  final List<ThermalPoint> thermalScanData;

  BlackIceSession({
    required this.status,
    required this.isIceDetected,
    required this.ambientTempF,
    required this.recommendedSpeedMph,
    required this.thermalScanData,
  });
}
