class AcousticHarmonicSignature {
  final double frequencyHz;
  final double amplitudeDb;
  final bool isAnomalous;

  AcousticHarmonicSignature({
    required this.frequencyHz,
    required this.amplitudeDb,
    required this.isAnomalous,
  });
}

class TireAcousticAnalysis {
  final String status; // "Monitoring", "Warning - Belt Separation Detected", "Critical - Imminent Blowout"
  final String activeTireLocation; // e.g. "Driver Side - Drive Axle 1 - Outer"
  final double confidencePct;
  final int estimatedMinutesToFailure;
  final List<AcousticHarmonicSignature> signatures;

  TireAcousticAnalysis({
    required this.status,
    required this.activeTireLocation,
    required this.confidencePct,
    required this.estimatedMinutesToFailure,
    required this.signatures,
  });
}
