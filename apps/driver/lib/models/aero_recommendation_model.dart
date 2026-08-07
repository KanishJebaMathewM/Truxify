class AeroModification {
  final String modName;
  final String description;
  final double estimatedCost;
  final double projectedFuelSavingsPercentage;
  final double annualSavingsPerTruck;
  final double roiMonths;
  final String confidenceLevel;

  AeroModification({
    required this.modName,
    required this.description,
    required this.estimatedCost,
    required this.projectedFuelSavingsPercentage,
    required this.annualSavingsPerTruck,
    required this.roiMonths,
    required this.confidenceLevel,
  });
}

class FleetAeroProfile {
  final String fleetId;
  final int totalTrailers;
  final double avgHighwaySpeedMph;
  final double percentHighwayMiles;
  final List<AeroModification> recommendations;

  FleetAeroProfile({
    required this.fleetId,
    required this.totalTrailers,
    required this.avgHighwaySpeedMph,
    required this.percentHighwayMiles,
    required this.recommendations,
  });
}
