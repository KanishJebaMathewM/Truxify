class BatteryHealth {
  final String truckId;
  final double currentVoltage; // Volts
  final double crankingVoltageDrop; // Volts dropped during start
  final double alternatorOutput; // Volts
  final int ambientTemp; // Fahrenheit
  final int daysToFailurePrediction; // ML predicted days until failure
  final String status; // 'Healthy', 'Warning', 'Critical'

  BatteryHealth({
    required this.truckId,
    required this.currentVoltage,
    required this.crankingVoltageDrop,
    required this.alternatorOutput,
    required this.ambientTemp,
    required this.daysToFailurePrediction,
    required this.status,
  });
}
