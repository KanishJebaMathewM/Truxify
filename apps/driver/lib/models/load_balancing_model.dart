class Pallet {
  final String id;
  final double weightLbs;
  final String content;
  final bool isPlaced;
  final String? recommendedZone; // "Zone A (Nose)", "Zone B (Middle)", "Zone C (Tail)"

  Pallet({
    required this.id,
    required this.weightLbs,
    required this.content,
    required this.isPlaced,
    this.recommendedZone,
  });
}

class LoadBalancingSession {
  final String status; // "Scanning Inbound Pallet...", "AR Projection Active"
  final bool isArActive;
  final double currentSteerWeight;
  final double currentDriveWeight;
  final double currentTandemWeight;
  final Pallet? activeScannedPallet;
  final List<Pallet> loadedPallets;

  LoadBalancingSession({
    required this.status,
    required this.isArActive,
    required this.currentSteerWeight,
    required this.currentDriveWeight,
    required this.currentTandemWeight,
    this.activeScannedPallet,
    required this.loadedPallets,
  });
}
