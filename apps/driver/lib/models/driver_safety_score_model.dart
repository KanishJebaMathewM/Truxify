class DriverSafetyScore {
  final String driverId;
  final String driverName;
  final String avatarUrl;
  final int totalScore;
  final int rank;
  final int harshBrakingEvents;
  final int speedingEvents;
  final int corneringEvents;
  final double milesDriven;
  final bool isCurrentUser;

  DriverSafetyScore({
    required this.driverId,
    required this.driverName,
    required this.avatarUrl,
    required this.totalScore,
    required this.rank,
    required this.harshBrakingEvents,
    required this.speedingEvents,
    required this.corneringEvents,
    required this.milesDriven,
    this.isCurrentUser = false,
  });
}
