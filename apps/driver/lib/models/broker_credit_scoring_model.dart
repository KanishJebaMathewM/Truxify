class BrokerCreditProfile {
  final String brokerId;
  final String brokerName;
  final String mcNumber;
  final int totalReports;
  final double averageDaysToPay;
  final int defaultReports;
  final String trustScore; // "A+", "B-", "F"
  final bool isWarningActive;

  BrokerCreditProfile({
    required this.brokerId,
    required this.brokerName,
    required this.mcNumber,
    required this.totalReports,
    required this.averageDaysToPay,
    required this.defaultReports,
    required this.trustScore,
    required this.isWarningActive,
  });
}
