class PlatoonTruck {
  final String truckId; // "Lead Truck (Unit 409)", "Drafting (Unit 812)"
  final double followingDistanceFeet;
  final double currentSpeedMph;
  final double brakeSyncLatencyMs;

  PlatoonTruck({
    required this.truckId,
    required this.followingDistanceFeet,
    required this.currentSpeedMph,
    required this.brakeSyncLatencyMs,
  });
}

class PlatoonSession {
  final String status; // "Searching for Platoon Partners...", "V2V SYNC ACTIVE"
  final bool isPlatoonActive;
  final double aerodynamicFuelSavingsPercent;
  final PlatoonTruck? leadTruck;
  final PlatoonTruck? selfTruck;

  PlatoonSession({
    required this.status,
    required this.isPlatoonActive,
    required this.aerodynamicFuelSavingsPercent,
    this.leadTruck,
    this.selfTruck,
  });
}
