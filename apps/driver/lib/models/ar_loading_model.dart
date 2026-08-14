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
