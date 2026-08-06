class TollRouteOption {
  final String routeId;
  final String routeName;
  final String description;
  final int estimatedTimeMinutes;
  final double estimatedTollCostUsd;
  final double estimatedFuelCostUsd;
  final double netProfitUsd;
  final bool isRecommended;

  TollRouteOption({
    required this.routeId,
    required this.routeName,
    required this.description,
    required this.estimatedTimeMinutes,
    required this.estimatedTollCostUsd,
    required this.estimatedFuelCostUsd,
    required this.netProfitUsd,
    required this.isRecommended,
  });
}
