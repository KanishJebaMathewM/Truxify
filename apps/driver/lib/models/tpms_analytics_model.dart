class TireTelemetry {
  final String tirePosition; // e.g., 'Steer Left', 'Drive Right Outer'
  final double currentPressurePsi;
  final double targetPressurePsi;
  final double temperatureFahrenheit;
  final double treadWearPredictionPct; // ML predicted wear
  final String status; // 'Optimal', 'Warning', 'Critical'

  TireTelemetry({
    required this.tirePosition,
    required this.currentPressurePsi,
    required this.targetPressurePsi,
    required this.temperatureFahrenheit,
    required this.treadWearPredictionPct,
    required this.status,
  });

  bool get isCritical => status == 'Critical';
  bool get isWarning => status == 'Warning';
}

class TruckTpmsState {
  final List<TireTelemetry> tires;
  final String overallStatus;
  
  TruckTpmsState({required this.tires, required this.overallStatus});
}
