class WeighStationInfo {
  final String stationName;
  final String highway;
  final double distanceMiles;

  WeighStationInfo({
    required this.stationName,
    required this.highway,
    required this.distanceMiles,
  });
}

class BypassSession {
  final String status; // "Approaching Scale...", "Transmitting WIM Data...", "BYPASS GRANTED"
  final WeighStationInfo station;
  final double currentGrossWeightLbs;
  final int safetyScoreIss; // Inspection Selection System score (1-100, lower is better)
  final bool? isBypassGranted; // null = pending, true = bypass, false = pull in

  BypassSession({
    required this.status,
    required this.station,
    required this.currentGrossWeightLbs,
    required this.safetyScoreIss,
    this.isBypassGranted,
  });
}
