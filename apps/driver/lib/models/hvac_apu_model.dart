class ApuSystem {
  final bool isRunning;
  final double batterySoc; // State of charge %
  final double currentDrawKw;
  final String activeMode; // "Idle", "Heating", "Cooling"

  ApuSystem({
    required this.isRunning,
    required this.batterySoc,
    required this.currentDrawKw,
    required this.activeMode,
  });
}

class HvacApuSession {
  final String status; // "Monitoring Sleep Cycle...", "Pre-conditioning Active"
  final DateTime estimatedWakeTime;
  final double currentCabTempF;
  final double targetCabTempF;
  final double ambientTempF;
  final ApuSystem apu;

  HvacApuSession({
    required this.status,
    required this.estimatedWakeTime,
    required this.currentCabTempF,
    required this.targetCabTempF,
    required this.ambientTempF,
    required this.apu,
  });
}
