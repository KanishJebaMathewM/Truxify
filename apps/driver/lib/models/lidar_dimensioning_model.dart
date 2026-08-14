class PalletDimensions {
  final double lengthInches;
  final double widthInches;
  final double heightInches;
  final double totalCubicFeet;
  final int estimatedFreightClass;

  PalletDimensions({
    required this.lengthInches,
    required this.widthInches,
    required this.heightInches,
    required this.totalCubicFeet,
    required this.estimatedFreightClass,
  });
}

class LidarScanSession {
  final String scanId;
  final String status; // "Initializing LiDAR", "Scanning Pallet...", "Scan Complete - Discrepancy Found"
  final double scanProgressPct;
  final PalletDimensions? shipperReported;
  final PalletDimensions? actualScanned;
  final double revenueRecoveredDollars;

  LidarScanSession({
    required this.scanId,
    required this.status,
    required this.scanProgressPct,
    this.shipperReported,
    this.actualScanned,
    required this.revenueRecoveredDollars,
  });
}
