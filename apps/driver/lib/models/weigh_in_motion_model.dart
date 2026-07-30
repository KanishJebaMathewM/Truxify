class WeighInMotionEvent {
  final String stationId;
  final String state;
  final double currentGrossWeightLbs;
  final double legalWeightLimitLbs;
  final bool isCompliant;
  final String bypassStatus; // 'CLEARED_TO_BYPASS', 'MUST_PULL_IN', 'APPROACHING'
  final DateTime timestamp;

  WeighInMotionEvent({
    required this.stationId,
    required this.state,
    required this.currentGrossWeightLbs,
    required this.legalWeightLimitLbs,
    required this.isCompliant,
    required this.bypassStatus,
    required this.timestamp,
  });
}
