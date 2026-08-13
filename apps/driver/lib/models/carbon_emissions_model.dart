class FuelConsumption {
  final String quarter;
  final double dieselGallonsPurchased;
  final double defGallonsPurchased;
  
  FuelConsumption({
    required this.quarter,
    required this.dieselGallonsPurchased,
    required this.defGallonsPurchased,
  });
}

class CarbonEmissionReport {
  final String reportingPeriod;
  final double totalDieselCO2MetricTons;
  final double totalDefCO2MetricTons;
  final double grossFleetEmissions;
  final double efficiencyRating; // CO2 per mile

  CarbonEmissionReport({
    required this.reportingPeriod,
    required this.totalDieselCO2MetricTons,
    required this.totalDefCO2MetricTons,
    required this.grossFleetEmissions,
    required this.efficiencyRating,
  });
}

class CarbonEmissionsSession {
  final String status;
  final List<FuelConsumption> rawFuelData;
  final CarbonEmissionReport? esgReport;
  final bool isCompiling;

  CarbonEmissionsSession({
    required this.status,
    required this.rawFuelData,
    this.esgReport,
    required this.isCompiling,
  });
}
