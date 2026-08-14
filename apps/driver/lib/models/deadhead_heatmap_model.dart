class MarketRegion {
  final String regionName;
  final String stateCode;
  final double loadToTruckRatio;
  final double averageReloadRate;
  final double emptyMileProbability;

  MarketRegion({
    required this.regionName,
    required this.stateCode,
    required this.loadToTruckRatio,
    required this.averageReloadRate,
    required this.emptyMileProbability,
  });
}

class DeadheadSession {
  final String status;
  final String activeDestination;
  final List<MarketRegion> heatmapData;
  final MarketRegion? selectedRegion;

  DeadheadSession({
    required this.status,
    required this.activeDestination,
    required this.heatmapData,
    this.selectedRegion,
  });
}
