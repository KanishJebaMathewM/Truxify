class ProduceAnalysis {
  final String commodity; // "Strawberries", "Romaine Lettuce"
  final double waterContentPercent;
  final double chlorophyllDegradationIndex; // 0-100, higher is worse
  final double internalBruisingPercent;
  final String freshnessGrade; // "A - Peak Freshness", "C - Degrading"
  final bool isClaimRisk;

  ProduceAnalysis({
    required this.commodity,
    required this.waterContentPercent,
    required this.chlorophyllDegradationIndex,
    required this.internalBruisingPercent,
    required this.freshnessGrade,
    required this.isClaimRisk,
  });
}

class HyperspectralSession {
  final String status; // "Scanning Cellular Signatures...", "Baseline Cryptographically Sealed"
  final bool isScanning;
  final ProduceAnalysis? analysis;
  final String? forensicHash;

  HyperspectralSession({
    required this.status,
    required this.isScanning,
    this.analysis,
    this.forensicHash,
  });
}
