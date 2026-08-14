class EnergyState {
  final double regenPowerKw;
  final double frictionBrakeTempF;
  final double batteryChargePercent;

  EnergyState({
    required this.regenPowerKw,
    required this.frictionBrakeTempF,
    required this.batteryChargePercent,
  });
}

class KersSession {
  final String status; // "Coasting", "Harvesting Kinetic Energy", "FRICTION BRAKE OVERHEATING"
  final bool isRegenActive;
  final bool isFrictionWarning;
  final double gradePercentage; // negative means downhill
  final EnergyState telemetry;

  KersSession({
    required this.status,
    required this.isRegenActive,
    required this.isFrictionWarning,
    required this.gradePercentage,
    required this.telemetry,
  });
}
