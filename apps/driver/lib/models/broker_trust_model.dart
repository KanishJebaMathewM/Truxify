class BrokerProfile {
  final String brokerId;
  final String companyName;
  final String mcNumber;
  final int trustScore; // 1-100
  final double averageDaysToPay;
  final double cancellationRatePercent;
  final int totalLoadsBrokered;
  final String riskCategory; // "Low Risk", "Moderate Risk", "High Risk"

  BrokerProfile({
    required this.brokerId,
    required this.companyName,
    required this.mcNumber,
    required this.trustScore,
    required this.averageDaysToPay,
    required this.cancellationRatePercent,
    required this.totalLoadsBrokered,
    required this.riskCategory,
  });
}

class BrokerTrustSession {
  final String status;
  final List<BrokerProfile> analyzedBrokers;

  BrokerTrustSession({
    required this.status,
    required this.analyzedBrokers,
  });
}
