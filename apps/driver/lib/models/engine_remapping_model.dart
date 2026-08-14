class EngineTune {
  final String profileName; // "Midwest Eco-Cruiser", "Rocky Mountain Hauler"
  final int maxHorsepower;
  final int peakTorqueLbFt;
  final String jakeBrakeProfile; // "Low-Aggression", "Max-Retardation"
  final String shiftingLogic; // "Early Up-shift (Fuel Save)", "Hold Gears (Climb)"

  EngineTune({
    required this.profileName,
    required this.maxHorsepower,
    required this.peakTorqueLbFt,
    required this.jakeBrakeProfile,
    required this.shiftingLogic,
  });
}

class RemappingSession {
  final String status; // "Active Tune: Eco", "FIRMWARE FLASH IN PROGRESS"
  final String currentRegion; // "Kansas Plains", "Colorado Rockies"
  final double upcomingGradePercent;
  final EngineTune activeTune;
  final bool isFlashing;

  RemappingSession({
    required this.status,
    required this.currentRegion,
    required this.upcomingGradePercent,
    required this.activeTune,
    required this.isFlashing,
  });
}
