class LtlLoad {
  final String loadId;
  final String pickupLocation;
  final String dropoffLocation;
  final int weightLbs;
  final int requiredPalletSpaces;
  final double payout;
  final int addedMiles; // Route deviation
  final double matchScore; // Percentage match based on route & capacity

  LtlLoad({
    required this.loadId,
    required this.pickupLocation,
    required this.dropoffLocation,
    required this.weightLbs,
    required this.requiredPalletSpaces,
    required this.payout,
    required this.addedMiles,
    required this.matchScore,
  });
}
