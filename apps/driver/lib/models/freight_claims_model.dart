class ImageForensics {
  final String imageHash;
  final DateTime captureTimestamp;
  final String gpsLocation;
  final bool isMetadataAuthentic; // Not photoshopped/altered
  final int securementStrapsDetected;
  final int loadBarsDetected;
  final double loadDistributionScore; // 0-100

  ImageForensics({
    required this.imageHash,
    required this.captureTimestamp,
    required this.gpsLocation,
    required this.isMetadataAuthentic,
    required this.securementStrapsDetected,
    required this.loadBarsDetected,
    required this.loadDistributionScore,
  });
}

class FreightClaimSession {
  final String loadId;
  final double claimAmountDollars;
  final String claimReason;
  final String status; // "Processing AI Forensics", "Driver Cleared - Liability Shifted"
  final ImageForensics? forensics;
  final String legalDefenseSummary;

  FreightClaimSession({
    required this.loadId,
    required this.claimAmountDollars,
    required this.claimReason,
    required this.status,
    this.forensics,
    required this.legalDefenseSummary,
  });
}
