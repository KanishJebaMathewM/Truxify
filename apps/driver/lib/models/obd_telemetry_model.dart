import 'package:flutter/foundation.dart';

class ObdTelemetry {
  final double? engineTemperature;
  final double? oilLevel;
  final double? tirePressureAvg;
  final double? predictiveHealthScore;
  final double? defUreaConcentration;
  final double? noxLevel;
  final List<String> warnings;

  ObdTelemetry({
    this.engineTemperature,
    this.oilLevel,
    this.tirePressureAvg,
    this.predictiveHealthScore,
    this.defUreaConcentration,
    this.noxLevel,
    required this.warnings,
  });

  factory ObdTelemetry.fromJson(Map<String, dynamic> json) {
    final et = json['engineTemperature']?.toDouble();
    final ol = json['oilLevel']?.toDouble();
    final tp = json['tirePressureAvg']?.toDouble();
    final ph = json['predictiveHealthScore']?.toDouble();
    final def = json['defUreaConcentration']?.toDouble();
    final nox = json['noxLevel']?.toDouble();
    if (et == null) debugPrint('ObdTelemetry: engineTemperature missing or null');
    if (ol == null) debugPrint('ObdTelemetry: oilLevel missing or null');
    if (tp == null) debugPrint('ObdTelemetry: tirePressureAvg missing or null');
    if (ph == null) debugPrint('ObdTelemetry: predictiveHealthScore missing or null');
    if (def == null) debugPrint('ObdTelemetry: defUreaConcentration missing or null');
    if (nox == null) debugPrint('ObdTelemetry: noxLevel missing or null');
    return ObdTelemetry(
      engineTemperature: et,
      oilLevel: ol,
      tirePressureAvg: tp,
      predictiveHealthScore: ph,
      defUreaConcentration: def,
      noxLevel: nox,
      warnings: List<String>.from(json['warnings'] ?? []),
    );
  }
}
