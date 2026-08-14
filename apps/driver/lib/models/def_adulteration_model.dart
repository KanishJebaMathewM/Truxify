class DefSample {
  final double ureaConcentration; // Ideal is 32.5%
  final double waterContent; // High water means adulteration
  final double mineralContamination; 

  DefSample({
    required this.ureaConcentration,
    required this.waterContent,
    required this.mineralContamination,
  });

  bool get isPure => ureaConcentration >= 32.0 && ureaConcentration <= 33.0 && mineralContamination < 1.0;
}

class DefSession {
  final String status; // "Awaiting Pumping Event", "Analyzing Fluid Quality", "CONTAMINATED FLUID DETECTED"
  final bool isIntakeValveLocked;
  final bool isAnalyzing;
  final DefSample currentSample;

  DefSession({
    required this.status,
    required this.isIntakeValveLocked,
    required this.isAnalyzing,
    required this.currentSample,
  });
}
