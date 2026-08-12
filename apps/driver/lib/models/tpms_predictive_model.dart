class TireData {
  final String position; // "Right Outer Drive", "Left Inner Trailer"
  final double currentPsi;
  final double tempFahrenheit;
  final bool isLeaking;
  final double pressureLossRatePerHour; // PSI drop per hour
  final int milesToCriticalFailure;

  TireData({
    required this.position,
    required this.currentPsi,
    required this.tempFahrenheit,
    required this.isLeaking,
    required this.pressureLossRatePerHour,
    required this.milesToCriticalFailure,
  });
}

class TpmsSession {
  final String status; // "Monitoring 18 Axles...", "PREDICTIVE LEAK DETECTED"
  final bool hasCriticalAlert;
  final List<TireData> tires;

  TpmsSession({
    required this.status,
    required this.hasCriticalAlert,
    required this.tires,
  });
}
