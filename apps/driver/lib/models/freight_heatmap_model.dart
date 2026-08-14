class HeatmapZone {
  final String zoneName; // "Midwest", "Southeast"
  final double currentAvgRatePerMile;
  final double predictedRatePerMile;
  final int daysInFuture;
  final String trend; // "Surging", "Stable", "Crashing"
  final String colorHex; // For heatmap rendering

  HeatmapZone({
    required this.zoneName,
    required this.currentAvgRatePerMile,
    required this.predictedRatePerMile,
    required this.daysInFuture,
    required this.trend,
    required this.colorHex,
  });
}

class HeatmapSession {
  final String status;
  final String selectedTrailerType; // "Dry Van", "Reefer"
  final List<HeatmapZone> zones;

  HeatmapSession({
    required this.status,
    required this.selectedTrailerType,
    required this.zones,
  });
}
