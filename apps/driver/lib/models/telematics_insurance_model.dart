class TelematicsScore {
  final int score; // 0-100
  final int hardBrakingEvents;
  final int speedingEvents;
  final double hosComplianceRate;
  final String reportPeriod;
  final double projectedDiscountPercentage;

  TelematicsScore({
    required this.score,
    required this.hardBrakingEvents,
    required this.speedingEvents,
    required this.hosComplianceRate,
    required this.reportPeriod,
    required this.projectedDiscountPercentage,
  });
}

class CryptoInsuranceReport {
  final String reportId;
  final TelematicsScore data;
  final String cryptographicHash;
  final String submissionStatus;

  CryptoInsuranceReport({
    required this.reportId,
    required this.data,
    required this.cryptographicHash,
    required this.submissionStatus,
  });
}
