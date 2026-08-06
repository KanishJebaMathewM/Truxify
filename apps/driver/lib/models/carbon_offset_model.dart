class CarbonOffsetQuote {
  final String loadId;
  final double estimatedCo2EmissionsKg;
  final double offsetCostUsd;
  final String offsetProjectName;
  final String certificationBody; // e.g., 'Gold Standard', 'Verra'

  CarbonOffsetQuote({
    required this.loadId,
    required this.estimatedCo2EmissionsKg,
    required this.offsetCostUsd,
    required this.offsetProjectName,
    required this.certificationBody,
  });
}
