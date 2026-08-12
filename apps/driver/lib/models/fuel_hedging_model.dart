class FuelStop {
  final String stationName;
  final String location;
  final double distanceAwayMiles;
  final double pricePerGallon;
  final double suggestedGallons;
  final bool isOptimal;

  FuelStop({
    required this.stationName,
    required this.location,
    required this.distanceAwayMiles,
    required this.pricePerGallon,
    required this.suggestedGallons,
    required this.isOptimal,
  });
}

class FuelHedgingSession {
  final String status; // "Calculating Arbitrage...", "Optimized Fuel Plan Generated"
  final double currentFuelLevelGallons;
  final double tankCapacityGallons;
  final double averageMpg;
  final double totalTripSavingsUsd;
  final List<FuelStop> plannedStops;

  FuelHedgingSession({
    required this.status,
    required this.currentFuelLevelGallons,
    required this.tankCapacityGallons,
    required this.averageMpg,
    required this.totalTripSavingsUsd,
    required this.plannedStops,
  });
}
