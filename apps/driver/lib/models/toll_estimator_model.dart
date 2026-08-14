class TollPlaza {
  final String name;
  final String country;
  final double localCurrencyAmount;
  final String localCurrencyCode;

  TollPlaza({
    required this.name,
    required this.country,
    required this.localCurrencyAmount,
    required this.localCurrencyCode,
  });
}

class TollEstimationSession {
  final String status;
  final String origin;
  final String destination;
  final List<TollPlaza> routeTolls;
  final double exchangeRateCADtoUSD;
  final double exchangeRateMXNtoUSD;
  final bool isEstimating;

  TollEstimationSession({
    required this.status,
    required this.origin,
    required this.destination,
    required this.routeTolls,
    required this.exchangeRateCADtoUSD,
    required this.exchangeRateMXNtoUSD,
    required this.isEstimating,
  });
  
  double get totalCostUSD {
    double total = 0.0;
    for (var toll in routeTolls) {
      if (toll.localCurrencyCode == 'USD') {
        total += toll.localCurrencyAmount;
      } else if (toll.localCurrencyCode == 'CAD') {
        total += toll.localCurrencyAmount * exchangeRateCADtoUSD;
      } else if (toll.localCurrencyCode == 'MXN') {
        total += toll.localCurrencyAmount * exchangeRateMXNtoUSD;
      }
    }
    return total;
  }
}
