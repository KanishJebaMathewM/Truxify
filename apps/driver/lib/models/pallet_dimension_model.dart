class PalletScanResult {
  final String scanId;
  final String originalClass;
  final double lengthInches;
  final double widthInches;
  final double heightInches;
  final double calculatedCubicFeet;
  final String recommendedFreightClass;
  final double projectedRevenueIncrease;

  PalletScanResult({
    required this.scanId,
    required this.originalClass,
    required this.lengthInches,
    required this.widthInches,
    required this.heightInches,
    required this.calculatedCubicFeet,
    required this.recommendedFreightClass,
    required this.projectedRevenueIncrease,
  });
}
