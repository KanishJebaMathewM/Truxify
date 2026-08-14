class ZoneDemand {
  final String locationName;
  final int emptyTrailersAvailable;
  final int projectedFreightVolume;
  final String status; // 'Surplus', 'Deficit', 'Balanced'

  ZoneDemand({
    required this.locationName,
    required this.emptyTrailersAvailable,
    required this.projectedFreightVolume,
    required this.status,
  });
}

class RepositioningAction {
  final String originZone;
  final String destinationZone;
  final int trailersToMove;
  final double estimatedCost;
  final double projectedRevenueSaved;

  RepositioningAction({
    required this.originZone,
    required this.destinationZone,
    required this.trailersToMove,
    required this.estimatedCost,
    required this.projectedRevenueSaved,
  });
}

class TrailerRepositioningSession {
  final String status;
  final List<ZoneDemand> zoneAnalytics;
  final List<RepositioningAction> suggestedActions;
  final bool isAnalyzing;

  TrailerRepositioningSession({
    required this.status,
    required this.zoneAnalytics,
    required this.suggestedActions,
    required this.isAnalyzing,
  });
}
