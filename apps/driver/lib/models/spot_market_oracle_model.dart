class MarketPricingOracle {
  final String loadId;
  final String origin;
  final String destination;
  final double brokerOfferUsd;
  final double fairMarketValueUsd;
  final double lowEndMarketUsd;
  final double highEndMarketUsd;
  final String marketCondition; // e.g. "Driver's Market", "Broker's Market"
  final double regionalTruckToLoadRatio;

  MarketPricingOracle({
    required this.loadId,
    required this.origin,
    required this.destination,
    required this.brokerOfferUsd,
    required this.fairMarketValueUsd,
    required this.lowEndMarketUsd,
    required this.highEndMarketUsd,
    required this.marketCondition,
    required this.regionalTruckToLoadRatio,
  });
}
