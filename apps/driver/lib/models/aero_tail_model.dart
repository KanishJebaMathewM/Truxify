class MotorizedFoil {
  final String location; // "Left Panel", "Right Panel", "Top Panel"
  final bool isDeployed;
  final double actuatorPositionPercent; // 0.0 (Folded) to 100.0 (Fully Deployed)
  final String status; // "Nominal", "Actuating", "Fault"

  MotorizedFoil({
    required this.location,
    required this.isDeployed,
    required this.actuatorPositionPercent,
    required this.status,
  });
}

class AeroTailSession {
  final String status; // "Folded - Low Speed", "Deploying Foils", "Maximum Aerodynamics"
  final double vehicleSpeedMph;
  final double dragReductionPercent;
  final List<MotorizedFoil> foils;

  AeroTailSession({
    required this.status,
    required this.vehicleSpeedMph,
    required this.dragReductionPercent,
    required this.foils,
  });
}
