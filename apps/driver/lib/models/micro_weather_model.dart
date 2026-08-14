class PeerTelemetry {
  final String truckId;
  final double distanceAheadMiles;
  final int wiperSpeed; // 0 = off, 1 = low, 2 = high, 3 = max
  final bool isTractionControlActive;
  final double ambientTempF;

  PeerTelemetry({
    required this.truckId,
    required this.distanceAheadMiles,
    required this.wiperSpeed,
    required this.isTractionControlActive,
    required this.ambientTempF,
  });
}

class MicroWeatherSession {
  final String status; // "Scanning Peer Network...", "MICRO-BURST DETECTED AHEAD"
  final bool isHazardDetected;
  final String? hazardType; // "Heavy Rain", "Black Ice", null
  final double recommendedSpeedMph;
  final List<PeerTelemetry> peerData;

  MicroWeatherSession({
    required this.status,
    required this.isHazardDetected,
    this.hazardType,
    required this.recommendedSpeedMph,
    required this.peerData,
  });
}
