class JurisdictionMileage {
  final String stateCode;
  final double milesDriven;
  final double fuelPurchasedGallons;
  final double taxRatePerGallon;
  final double taxOwedUsd;

  JurisdictionMileage({
    required this.stateCode,
    required this.milesDriven,
    required this.fuelPurchasedGallons,
    required this.taxRatePerGallon,
    required this.taxOwedUsd,
  });
}

class IftaQuarterlyReport {
  final String quarter;
  final String year;
  final double totalMiles;
  final double totalFuelGallons;
  final double totalTaxOwed;
  final List<JurisdictionMileage> jurisdictionBreakdown;

  IftaQuarterlyReport({
    required this.quarter,
    required this.year,
    required this.totalMiles,
    required this.totalFuelGallons,
    required this.totalTaxOwed,
    required this.jurisdictionBreakdown,
  });
}
