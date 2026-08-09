class LtlConsolidationLoad {
  final String loadId;
  final String origin;
  final String destination;
  final double weightLbs;
  final double requiredLinearFeet; // Space needed in the trailer
  final double addedRevenue;
  final double detourMiles;
  final double matchScore; // 0-100 score on how well it fits the existing route

  LtlConsolidationLoad({
    required this.loadId,
    required this.origin,
    required this.destination,
    required this.weightLbs,
    required this.requiredLinearFeet,
    required this.addedRevenue,
    required this.detourMiles,
    required this.matchScore,
  });
}
