class PalletInstruction {
  final String palletId;
  final String cargoType;
  final double weightLbs;
  final String targetZone; // e.g., 'Nose - Left', 'Tail - Right', 'Over Axle'
  final bool isLoaded;

  PalletInstruction({
    required this.palletId,
    required this.cargoType,
    required this.weightLbs,
    required this.targetZone,
    required this.isLoaded,
  });
}

class TrailerLoadState {
  final double maxWeightLbs;
  final double currentWeightLbs;
  final double balanceScorePct; // 100% is perfect axle distribution
  final List<PalletInstruction> pendingPallets;
  final PalletInstruction? activeInstruction;

  TrailerLoadState({
    required this.maxWeightLbs,
    required this.currentWeightLbs,
    required this.balanceScorePct,
    required this.pendingPallets,
    this.activeInstruction,
  });
}
