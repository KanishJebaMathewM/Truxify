class PlatoonMatch {
  final String matchId;
  final String partnerDriverName;
  final String partnerCompany;
  final String highwayRoute; // e.g. 'I-80 Westbound'
  final double distanceAheadMiles;
  final double estimatedFuelSavingsPercent;
  final int matchingMiles; // How many miles they share on the route

  PlatoonMatch({
    required this.matchId,
    required this.partnerDriverName,
    required this.partnerCompany,
    required this.highwayRoute,
    required this.distanceAheadMiles,
    required this.estimatedFuelSavingsPercent,
    required this.matchingMiles,
  });
}
