class DynamicTollRoute {
  final String routeName;
  final double timeHours;
  final double distanceMiles;
  final double class8TollCostUsd;
  final double fuelCostUsd;
  final double netProfitUsd;
  final bool isHighestProfit;

  DynamicTollRoute({
    required this.routeName,
    required this.timeHours,
    required this.distanceMiles,
    required this.class8TollCostUsd,
    required this.fuelCostUsd,
    required this.netProfitUsd,
    required this.isHighestProfit,
  });
}
