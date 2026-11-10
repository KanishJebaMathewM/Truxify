class PalletDirective {
  final String palletId;
  final String dimensions; // "48x40x60"
  final int weightLbs;
  final String placementZone; // "Nose - Left", "Tail - Center"
  final bool isPlaced;

  PalletDirective({
    required this.palletId,
    required this.dimensions,
    required this.weightLbs,
    required this.placementZone,
    required this.isPlaced,
  });
}

class ArLoadingSession {
  final String status; // "Mapping 53ft Trailer...", "AR Projection Active"
  final int totalPallets;
  final int placedPallets;
  final double steerAxleLbs; // Target ~12,000
  final double driveAxleLbs; // Target ~34,000
  final double tandemAxleLbs; // Target ~34,000
  final PalletDirective? activePallet;
  final List<PalletDirective> completedPallets;

  ArLoadingSession({
    required this.status,
    required this.totalPallets,
    required this.placedPallets,
    required this.steerAxleLbs,
    required this.driveAxleLbs,
    required this.tandemAxleLbs,
    required this.activePallet,
    required this.completedPallets,
  });
}

/// A pallet instruction for the AR loading optimizer (the optimizer service's
/// newer model; distinct from the AR projection screen's PalletDirective).
class PalletInstruction {
  final String palletId;
  final String cargoType;
  final int weightLbs;
  final String targetZone; // e.g. "Over Axle - Center", "Nose - Left"
  final bool isLoaded;

  const PalletInstruction({
    required this.palletId,
    required this.cargoType,
    required this.weightLbs,
    required this.targetZone,
    required this.isLoaded,
  });
}

/// Streamed trailer load state from the AR loading optimizer.
class TrailerLoadState {
  final int maxWeightLbs;
  final int currentWeightLbs;
  final double balanceScorePct;
  final List<PalletInstruction> pendingPallets;
  final PalletInstruction? activeInstruction;

  const TrailerLoadState({
    required this.maxWeightLbs,
    required this.currentWeightLbs,
    required this.balanceScorePct,
    required this.pendingPallets,
    required this.activeInstruction,
  });
}
