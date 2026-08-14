class EngineEcmState {
  final String activeTuneMap; // "Flatland Eco-Mode", "Rocky Mountain Max Torque", "Descent Engine Braking"
  final double currentGradePct; // e.g. 6.5% incline
  final int maxTorqueLbFt;
  final int shiftPointRpm;
  final double engineLoadPct;
  final String nextTopographyEvent;

  EngineEcmState({
    required this.activeTuneMap,
    required this.currentGradePct,
    required this.maxTorqueLbFt,
    required this.shiftPointRpm,
    required this.engineLoadPct,
    required this.nextTopographyEvent,
  });
}

class OtaTuningSession {
  final String truckVin;
  final String status; // "Cruising", "OTA Map Flash in Progress", "Mountain Map Active"
  final EngineEcmState ecm;

  OtaTuningSession({
    required this.truckVin,
    required this.status,
    required this.ecm,
  });
}
