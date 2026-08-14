class PlatoonMember {
  final String truckId;
  final String role; // "Leader (Windbreaker)", "Follower 1", "Follower 2"
  final double distanceFeet;
  final double aerodynamicSavingsPercent;
  final double activeStreamUsd; // Total money streamed so far

  PlatoonMember({
    required this.truckId,
    required this.role,
    required this.distanceFeet,
    required this.aerodynamicSavingsPercent,
    required this.activeStreamUsd,
  });
}

class PlatoonHedgingSession {
  final String status; // "Searching for Platoon...", "Smart Contract Active"
  final bool isPlatooning;
  final String? smartContractAddress;
  final double currentSpeedMph;
  final double myNetEarningsUsd; // Negative if paying, positive if receiving
  final List<PlatoonMember> members;

  PlatoonHedgingSession({
    required this.status,
    required this.isPlatooning,
    this.smartContractAddress,
    required this.currentSpeedMph,
    required this.myNetEarningsUsd,
    required this.members,
  });
}
