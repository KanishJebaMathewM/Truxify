class TruckProfile {
  final double heightFeet;
  final double widthFeet;
  final double grossWeightLbs;
  final int axles;
  final String hazmatClass; // e.g. 'NONE', 'FLAMMABLE', 'CORROSIVE'
  final bool has53FootTrailer;

  TruckProfile({
    required this.heightFeet,
    required this.widthFeet,
    required this.grossWeightLbs,
    required this.axles,
    required this.hazmatClass,
    required this.has53FootTrailer,
  });
}

class NavigationRoute {
  final String routeId;
  final String polylineEncoded;
  final double distanceMiles;
  final double estimatedTimeMinutes;
  final List<String> avoidedHazards; // e.g. ['Low Bridge (11ft)', 'Weight Restricted Bridge']

  NavigationRoute({
    required this.routeId,
    required this.polylineEncoded,
    required this.distanceMiles,
    required this.estimatedTimeMinutes,
    required this.avoidedHazards,
  });
}
