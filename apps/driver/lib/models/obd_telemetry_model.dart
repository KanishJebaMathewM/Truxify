class ObdTelemetry {
  final double engineTemperature;
  final double oilLevel;
  final double tirePressureAvg;
  final double predictiveHealthScore;
  final List<String> warnings;

  ObdTelemetry({
    required this.engineTemperature,
    required this.oilLevel,
    required this.tirePressureAvg,
    required this.predictiveHealthScore,
    required this.warnings,
  });

  factory ObdTelemetry.fromJson(Map<String, dynamic> json) {
    return ObdTelemetry(
      engineTemperature: json['engineTemperature']?.toDouble() ?? 0.0,
      oilLevel: json['oilLevel']?.toDouble() ?? 0.0,
      tirePressureAvg: json['tirePressureAvg']?.toDouble() ?? 0.0,
      predictiveHealthScore: json['predictiveHealthScore']?.toDouble() ?? 0.0,
      warnings: List<String>.from(json['warnings'] ?? []),
    );
  }
}
