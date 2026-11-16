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
    final missingFields = <String>[
      if (et == null) 'engineTemperature',
      if (ol == null) 'oilLevel',
      if (tp == null) 'tirePressureAvg',
      if (ph == null) 'predictiveHealthScore',
      if (def == null) 'defUreaConcentration',
      if (nox == null) 'noxLevel',
    ];
    if (missingFields.isNotEmpty) {
      debugPrint('ObdTelemetry: missing fields: ${missingFields.join(', ')}');
    }
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

/// Live OBD-II telemetry from the maintenance service (the fleet maintenance
/// screen's model; distinct from the backend-facing ObdTelemetry report).
class ObdTelemetryModel {
  final double engineTemperature; // °C
  final double tirePressure; // PSI
  final double fluidLevels; // %
  final DateTime timestamp;

  const ObdTelemetryModel({
    required this.engineTemperature,
    required this.tirePressure,
    required this.fluidLevels,
    required this.timestamp,
  });
}
