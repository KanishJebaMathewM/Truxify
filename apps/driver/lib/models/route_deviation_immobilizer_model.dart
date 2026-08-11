class RouteDeviationStatus {
  final bool isHighValueCargo;
  final String cargoType;
  final double allowedDeviationMiles;
  final double currentDeviationMiles;
  final String status; // "Secure", "Warning", "Immobilized"
  final String message;
  final int speedLimitMph; // Reduced when immobilized

  RouteDeviationStatus({
    required this.isHighValueCargo,
    required this.cargoType,
    required this.allowedDeviationMiles,
    required this.currentDeviationMiles,
    required this.status,
    required this.message,
    required this.speedLimitMph,
  });
}
