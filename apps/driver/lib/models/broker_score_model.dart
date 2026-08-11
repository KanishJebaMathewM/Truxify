class BrokerReliabilityScore {
  final String brokerId;
  final String brokerName;
  final int overallScore; // 0-100
  final double averageDaysToPay;
  final double loadCancellationRate; // Percentage
  final double driverRating; // out of 5.0
  final bool isFactoringApproved;
  final List<String> recentReviews;

  BrokerReliabilityScore({
    required this.brokerId,
    required this.brokerName,
    required this.overallScore,
    required this.averageDaysToPay,
    required this.loadCancellationRate,
    required this.driverRating,
    required this.isFactoringApproved,
    required this.recentReviews,
  });
}
