class PredictiveEta {
  final String loadId;
  final double baseDistanceMiles;
  final DateTime standardEta; // Basic distance / speed
  final DateTime mlPredictedEta; // Factoring in ML variables
  final int addedDelayMinutes;
  final Map<String, int> delayFactors; // e.g. {'Weather': 15, 'HoS Break': 30, 'Dock Wait': 45}

  PredictiveEta({
    required this.loadId,
    required this.baseDistanceMiles,
    required this.standardEta,
    required this.mlPredictedEta,
    required this.addedDelayMinutes,
    required this.delayFactors,
  });
}
