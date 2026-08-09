class TireHarmonicData {
  final String tirePosition; // e.g., "Drive Axle 1 - Outer Left"
  final double currentFrequencyHz;
  final double baselineFrequencyHz;
  final double anomalyScore; // 0.0 to 1.0 (1.0 = imminent failure)
  final String status; // "Normal", "Warning", "CRITICAL"

  TireHarmonicData({
    required this.tirePosition,
    required this.currentFrequencyHz,
    required this.baselineFrequencyHz,
    required this.anomalyScore,
    required this.status,
  });
}

class AcousticAnalysisStatus {
  final bool isListening;
  final List<TireHarmonicData> tireData;
  final bool hasCriticalWarning;

  AcousticAnalysisStatus({
    required this.isListening,
    required this.tireData,
    required this.hasCriticalWarning,
  });
}
