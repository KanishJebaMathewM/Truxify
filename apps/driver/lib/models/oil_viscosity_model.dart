class FluidAnalysis {
  final double dielectricConstant;
  final double viscosityIndex;
  final double sootContaminationPercent;
  final double tempFahrenheit;

  FluidAnalysis({
    required this.dielectricConstant,
    required this.viscosityIndex,
    required this.sootContaminationPercent,
    required this.tempFahrenheit,
  });
}

class OilSession {
  final String status; // "Oil Quality Optimal", "VISCOSITY BREAKDOWN DETECTED"
  final bool isServiceRequired;
  final int currentMilesSinceChange;
  final int recommendedServiceMiles;
  final FluidAnalysis telemetry;

  OilSession({
    required this.status,
    required this.isServiceRequired,
    required this.currentMilesSinceChange,
    required this.recommendedServiceMiles,
    required this.telemetry,
  });
}
