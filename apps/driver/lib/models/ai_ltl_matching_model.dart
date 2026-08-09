class PartialLoadMatch {
  final String loadId;
  final String pickupCity;
  final String dropoffCity;
  final double requiredLinearFeet;
  final double requiredWeightLbs;
  final double additionalPayoutUsd;
  final double detourTimeHours;
  final double matchScorePct;

  PartialLoadMatch({
    required this.loadId,
    required this.pickupCity,
    required this.dropoffCity,
    required this.requiredLinearFeet,
    required this.requiredWeightLbs,
    required this.additionalPayoutUsd,
    required this.detourTimeHours,
    required this.matchScorePct,
  });
}

class TrailerCapacityState {
  final double totalLinearFeet;
  final double availableLinearFeet;
  final double totalWeightCapLbs;
  final double availableWeightLbs;
  final List<PartialLoadMatch> recommendedMatches;

  TrailerCapacityState({
    required this.totalLinearFeet,
    required this.availableLinearFeet,
    required this.totalWeightCapLbs,
    required this.availableWeightLbs,
    required this.recommendedMatches,
  });
}
