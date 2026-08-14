class RouteFinancials {
  final String routeName;
  final String routeType; // "Fastest", "Most Profitable", "Toll-Free"
  final int timeMinutes;
  final double fuelCostDollars;
  final double tollCostDollars;
  final double driverPayDollars;
  final double totalTripCost;
  final double netProfitMargin;
  final bool isRecommended;

  RouteFinancials({
    required this.routeName,
    required this.routeType,
    required this.timeMinutes,
    required this.fuelCostDollars,
    required this.tollCostDollars,
    required this.driverPayDollars,
    required this.totalTripCost,
    required this.netProfitMargin,
    required this.isRecommended,
  });
}

class TollOptimizationSession {
  final String origin;
  final String destination;
  final double grossRevenue; // What the broker is paying
  final String status; // "Calculating Axle Tolls", "Analyzing Financials", "Optimal Route Found"
  final List<RouteFinancials> alternativeRoutes;

  TollOptimizationSession({
    required this.origin,
    required this.destination,
    required this.grossRevenue,
    required this.status,
    required this.alternativeRoutes,
  });
}
