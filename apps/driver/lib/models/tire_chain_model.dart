class PneumaticChainSystem {
  final bool isDeployed;
  final double airPressurePsi; // needs ~90-120 psi to deploy
  final double currentRpm;

  PneumaticChainSystem({
    required this.isDeployed,
    required this.airPressurePsi,
    required this.currentRpm,
  });
}

class TireChainSession {
  final String status; // "System Standby", "Traction Loss Detected", "CHAINS DEPLOYED"
  final bool isHazardActive;
  final double roadGrade;
  final double wheelSlipPercentage;
  final double ambientTempF;
  final double vehicleSpeedMph;
  final PneumaticChainSystem chainSystem;

  TireChainSession({
    required this.status,
    required this.isHazardActive,
    required this.roadGrade,
    required this.wheelSlipPercentage,
    required this.ambientTempF,
    required this.vehicleSpeedMph,
    required this.chainSystem,
  });
}
