class WimBypassRequest {
  final String stationId;
  final String stationName;
  final double distanceMiles;
  final double truckSafetyScore;
  final double estimatedGrossWeightLbs;
  final String cryptographicSignature;
  final String status; // 'Approaching', 'Transmitting', 'Cleared', 'Pull In'

  WimBypassRequest({
    required this.stationId,
    required this.stationName,
    required this.distanceMiles,
    required this.truckSafetyScore,
    required this.estimatedGrossWeightLbs,
    required this.cryptographicSignature,
    required this.status,
  });
}
