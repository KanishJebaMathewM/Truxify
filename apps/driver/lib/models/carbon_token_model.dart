class CarbonMintSession {
  final String tripId;
  final double distanceMiles;
  final double baselineEmissionsKg; // What a standard truck would emit
  final double actualEmissionsKg; // What this EV/aero truck emitted
  final double emissionsSavedKg;
  final double tokensMinted; // 1 Token = 1 Kg saved
  final String blockchainTxHash;
  final String status; // 'Analyzing', 'Minting', 'Minted'

  CarbonMintSession({
    required this.tripId,
    required this.distanceMiles,
    required this.baselineEmissionsKg,
    required this.actualEmissionsKg,
    required this.emissionsSavedKg,
    required this.tokensMinted,
    required this.blockchainTxHash,
    required this.status,
  });
}

class CarbonWalletState {
  final String walletAddress;
  final double totalTokensBalance;
  final double marketPricePerTokenUsd; // e.g. $0.05 per kg

  CarbonWalletState({
    required this.walletAddress,
    required this.totalTokensBalance,
    required this.marketPricePerTokenUsd,
  });
  
  double get totalValueUsd => totalTokensBalance * marketPricePerTokenUsd;
}
