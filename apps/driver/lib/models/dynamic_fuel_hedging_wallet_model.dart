class FuelFutureContract {
  final String contractId;
  final String stationChain;
  final double gallonsLocked;
  final double lockedPricePerGallonUsd;
  final double currentPumpPriceUsd;
  final DateTime expiresAt;
  final String locationArea;
  final bool isRedeemed;

  FuelFutureContract({
    required this.contractId,
    required this.stationChain,
    required this.gallonsLocked,
    required this.lockedPricePerGallonUsd,
    required this.currentPumpPriceUsd,
    required this.expiresAt,
    required this.locationArea,
    required this.isRedeemed,
  });

  double get potentialSavings => (currentPumpPriceUsd - lockedPricePerGallonUsd) * gallonsLocked;
}

class FuelHedgingWallet {
  final double availableBalanceUsd;
  final List<FuelFutureContract> activeContracts;
  
  FuelHedgingWallet({
    required this.availableBalanceUsd,
    required this.activeContracts,
  });
}
