class RouteRestriction {
  final String featureName;
  final String location;
  final String restrictionType; // 'Tunnel', 'City Center', 'Bridge'
  final String penalty; // e.g. '$10,000 Fine'

  RouteRestriction({
    required this.featureName,
    required this.location,
    required this.restrictionType,
    required this.penalty,
  });
}

class SafeHaven {
  final String havenName;
  final String location;
  final bool hasSecurity;
  final int distanceDetourMiles;

  SafeHaven({
    required this.havenName,
    required this.location,
    required this.hasSecurity,
    required this.distanceDetourMiles,
  });
}

class SafeHavenSession {
  final String status;
  final bool hazmatModeActive;
  final List<RouteRestriction> avoidedHazards;
  final List<SafeHaven> certifiedHavens;
  final double addedDetourMiles;
  final bool isRecalculating;

  SafeHavenSession({
    required this.status,
    required this.hazmatModeActive,
    required this.avoidedHazards,
    required this.certifiedHavens,
    required this.addedDetourMiles,
    required this.isRecalculating,
  });
}
