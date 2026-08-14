class PlatoonMember {
  final String truckId;
  final String driverName;
  final String role; // "Lead Truck", "Follower"
  final double currentSpeedMph;
  final double followDistanceFeet;
  final double fuelSavingsPct; // percentage of fuel saved

  PlatoonMember({
    required this.truckId,
    required this.driverName,
    required this.role,
    required this.currentSpeedMph,
    required this.followDistanceFeet,
    required this.fuelSavingsPct,
  });
}

class PlatoonSession {
  final String platoonId;
  final String status; // "Searching for Partner", "Pairing", "Active Platooning", "Disengaged"
  final double targetSpeedMph;
  final double optimalGapFeet;
  final double totalFuelSavedGallons;
  final double totalFinancialSavings;
  final List<PlatoonMember> members;

  PlatoonSession({
    required this.platoonId,
    required this.status,
    required this.targetSpeedMph,
    required this.optimalGapFeet,
    required this.totalFuelSavedGallons,
    required this.totalFinancialSavings,
    required this.members,
  });
}
