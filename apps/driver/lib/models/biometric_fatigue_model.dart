class FatigueState {
  final double blinkRatePerMinute;
  final double headNodCount;
  final double overallFatigueScorePct;
  final bool isCritical;
  final String recommendedAction;

  FatigueState({
    required this.blinkRatePerMinute,
    required this.headNodCount,
    required this.overallFatigueScorePct,
    required this.isCritical,
    required this.recommendedAction,
  });
}

class HosRoutingRecommendation {
  final String locationName;
  final double distanceMiles;
  final double detourTimeHours;
  final int remainingHosMinutes;

  HosRoutingRecommendation({
    required this.locationName,
    required this.distanceMiles,
    required this.detourTimeHours,
    required this.remainingHosMinutes,
  });
}
