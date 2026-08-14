class WorkZoneEvent {
  final String highwaySegment;
  final String constructionType; // e.g. "Bridge Repair", "Paving"
  final int predictedDelayMinutes;
  final String impactSeverity; // "Low", "Moderate", "Severe"
  final DateTime scheduledStart;
  final DateTime scheduledEnd;
  
  WorkZoneEvent({
    required this.highwaySegment,
    required this.constructionType,
    required this.predictedDelayMinutes,
    required this.impactSeverity,
    required this.scheduledStart,
    required this.scheduledEnd,
  });
}

class WorkZoneRouteAnalysis {
  final String routeId;
  final int totalPredictedDelayMinutes;
  final List<WorkZoneEvent> activeZones;
  final bool rerouteRecommended;
  final int rerouteTimeSavingsMinutes;

  WorkZoneRouteAnalysis({
    required this.routeId,
    required this.totalPredictedDelayMinutes,
    required this.activeZones,
    required this.rerouteRecommended,
    required this.rerouteTimeSavingsMinutes,
  });
}
