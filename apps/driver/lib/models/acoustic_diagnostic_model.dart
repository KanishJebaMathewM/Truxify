class AcousticDiagnosticResult {
  final String scanId;
  final String detectedAnomaly;
  final String severityLevel; // 'Low', 'Medium', 'Critical'
  final double confidenceScore;
  final String recommendedAction;
  final bool isSafeToDrive;

  AcousticDiagnosticResult({
    required this.scanId,
    required this.detectedAnomaly,
    required this.severityLevel,
    required this.confidenceScore,
    required this.recommendedAction,
    required this.isSafeToDrive,
  });
}
