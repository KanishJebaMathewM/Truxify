class BiometricData {
  final int heartRateBpm;
  final double hrvMs; // Heart Rate Variability in milliseconds
  final String ecgRhythm; // "Normal Sinus", "Premature Ventricular Contractions (PVCs)", "Ventricular Fibrillation"

  BiometricData({
    required this.heartRateBpm,
    required this.hrvMs,
    required this.ecgRhythm,
  });
}

class HealthSession {
  final String status; // "Monitoring Biometrics...", "MEDICAL EMERGENCY DETECTED"
  final bool isEmergencyActive;
  final bool isAutonomousPullOverActive;
  final bool is911Dispatched;
  final BiometricData biometrics;

  HealthSession({
    required this.status,
    required this.isEmergencyActive,
    required this.isAutonomousPullOverActive,
    required this.is911Dispatched,
    required this.biometrics,
  });
}
