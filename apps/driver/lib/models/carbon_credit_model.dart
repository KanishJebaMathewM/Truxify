class EcoTripData {
  final String tripId;
  final double gallonsSaved; // vs baseline
  final double co2EmissionsAvoidedKg;
  final int earnedCarbonTokens;
  final String drivingBehavior; // 'Excellent Coasting', 'Smooth Braking'
  final DateTime tripDate;

  EcoTripData({
    required this.tripId,
    required this.gallonsSaved,
    required this.co2EmissionsAvoidedKg,
    required this.earnedCarbonTokens,
    required this.drivingBehavior,
    required this.tripDate,
  });
}
