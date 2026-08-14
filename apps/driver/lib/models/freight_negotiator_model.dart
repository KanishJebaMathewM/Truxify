class MarketLaneData {
  final String origin;
  final String destination;
  final double currentMarketAverageRate;
  final double sevenDayHigh;
  final double sevenDayLow;
  final double brokerInitialOffer;

  MarketLaneData({
    required this.origin,
    required this.destination,
    required this.currentMarketAverageRate,
    required this.sevenDayHigh,
    required this.sevenDayLow,
    required this.brokerInitialOffer,
  });
  
  double get variance => currentMarketAverageRate - brokerInitialOffer;
  bool get isLowball => brokerInitialOffer < currentMarketAverageRate;
}

class NegotiationSession {
  final String status;
  final MarketLaneData? laneData;
  final double targetCounterOffer;
  final String generatedEmailScript;

  NegotiationSession({
    required this.status,
    this.laneData,
    required this.targetCounterOffer,
    required this.generatedEmailScript,
  });
}
