class RouteStop {
  final int originalIndex;
  final int optimizedIndex;
  final String address;
  final String contactName;
  final double distanceFromPreviousMiles;

  RouteStop({
    required this.originalIndex,
    required this.optimizedIndex,
    required this.address,
    required this.contactName,
    required this.distanceFromPreviousMiles,
  });
}

class TspOptimizationSession {
  final String status;
  final double originalTotalMiles;
  final double optimizedTotalMiles;
  final double estimatedFuelSavedGallons;
  final List<RouteStop> optimizedStops;

  TspOptimizationSession({
    required this.status,
    required this.originalTotalMiles,
    required this.optimizedTotalMiles,
    required this.estimatedFuelSavedGallons,
    required this.optimizedStops,
  });
}
