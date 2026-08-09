class DefSensorReading {
  final double ureaConcentrationPct; // Optimal is 32.5%
  final double tankTemperatureF;
  final double noxReductionEfficiencyPct; // Expected > 95%
  final String status; // "Optimal", "Warning", "Critical - Shut Down"
  final String systemMessage;
  final bool isEngineKillRequired;

  DefSensorReading({
    required this.ureaConcentrationPct,
    required this.tankTemperatureF,
    required this.noxReductionEfficiencyPct,
    required this.status,
    required this.systemMessage,
    required this.isEngineKillRequired,
  });
}
