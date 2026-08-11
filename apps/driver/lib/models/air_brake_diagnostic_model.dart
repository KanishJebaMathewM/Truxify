class AirBrakeLeak {
  final String componentName; // "Service Line Gladhand", "Primary Tank Valve"
  final String locationArea; // "Trailer Nose", "Drive Axle"
  final double severityPsiDropPerMin;
  final double acousticConfidence; // 0-100%

  AirBrakeLeak({
    required this.componentName,
    required this.locationArea,
    required this.severityPsiDropPerMin,
    required this.acousticConfidence,
  });
}

class AirBrakeDiagnosticSession {
  final String status; // "Acoustic Scanning Active...", "Pinhole Leak Pinpointed"
  final bool isScanning;
  final double systemPsi;
  final AirBrakeLeak? detectedLeak;
  
  AirBrakeDiagnosticSession({
    required this.status,
    required this.isScanning,
    required this.systemPsi,
    this.detectedLeak,
  });
}
