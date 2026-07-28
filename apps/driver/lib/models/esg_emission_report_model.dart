class EsgEmissionReport {
  final String reportId;
  final String loadReference;
  final double distanceMiles;
  final double loadWeightLbs;
  final double fuelEfficiencyMpg;
  final double co2EmissionsKg;
  final DateTime calculationDate;

  EsgEmissionReport({
    required this.reportId,
    required this.loadReference,
    required this.distanceMiles,
    required this.loadWeightLbs,
    required this.fuelEfficiencyMpg,
    required this.co2EmissionsKg,
    required this.calculationDate,
  });
}
