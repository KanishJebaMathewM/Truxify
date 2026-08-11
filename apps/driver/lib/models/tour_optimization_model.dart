class TourLeg {
  final String origin;
  final String destination;
  final int loadedMiles;
  final int emptyMilesToPickup;
  final double payout;
  final DateTime pickupTime;
  final DateTime deliveryTime;

  TourLeg({
    required this.origin,
    required this.destination,
    required this.loadedMiles,
    required this.emptyMilesToPickup,
    required this.payout,
    required this.pickupTime,
    required this.deliveryTime,
  });
}

class OptimizedTour {
  final String homeBase;
  final List<TourLeg> legs;
  final int totalLoadedMiles;
  final int totalEmptyMiles;
  final double totalPayout;
  final double emptyMilePercentage;
  final int durationDays;

  OptimizedTour({
    required this.homeBase,
    required this.legs,
    required this.totalLoadedMiles,
    required this.totalEmptyMiles,
    required this.totalPayout,
    required this.emptyMilePercentage,
    required this.durationDays,
  });
}
