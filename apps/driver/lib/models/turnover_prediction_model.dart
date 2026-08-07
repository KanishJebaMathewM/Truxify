class DriverChurnRisk {
  final String driverId;
  final String driverName;
  final int churnRiskScore; // 0-100 (Higher is worse)
  final String riskCategory; // 'Low', 'Medium', 'High', 'Critical'
  final List<String> contributingFactors;
  final double recentSentimentTrend; // Negative means sentiment is dropping
  final String recommendedIntervention;

  DriverChurnRisk({
    required this.driverId,
    required this.driverName,
    required this.churnRiskScore,
    required this.riskCategory,
    required this.contributingFactors,
    required this.recentSentimentTrend,
    required this.recommendedIntervention,
  });
}
