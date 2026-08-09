class PricingInsight {
  final String loadId;
  final double suggestedBid;
  final double marketAverage;
  final double fuelSurchargeEstimate;
  final double probabilityOfWinning; // 0.0 to 1.0
  final String laneOrigin;
  final String laneDestination;

  PricingInsight({
    required this.loadId,
    required this.suggestedBid,
    required this.marketAverage,
    required this.fuelSurchargeEstimate,
    required this.probabilityOfWinning,
    required this.laneOrigin,
    required this.laneDestination,
  });

  double get minRecommendedBid => suggestedBid * 0.95;
  double get maxRecommendedBid => suggestedBid * 1.10;
}
