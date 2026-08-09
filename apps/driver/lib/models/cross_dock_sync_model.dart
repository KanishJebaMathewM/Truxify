class TruckTelemetry {
  final String truckId;
  final String role; // "Inbound" or "Outbound"
  final double distanceToDockMiles;
  final int estimatedArrivalMinutes;
  final double currentSpeedMph;
  final double targetSpeedMph; // The recommended speed for perfect sync

  TruckTelemetry({
    required this.truckId,
    required this.role,
    required this.distanceToDockMiles,
    required this.estimatedArrivalMinutes,
    required this.currentSpeedMph,
    required this.targetSpeedMph,
  });
}

class CrossDockSession {
  final String facilityName;
  final String facilityLocation;
  final int syncDeltaMinutes; // Difference in ETA between the two trucks
  final TruckTelemetry selfTruck;
  final TruckTelemetry partnerTruck;
  final String adviceText;
  final String status; // "Out of Sync", "Synchronizing", "Perfect Sync"

  CrossDockSession({
    required this.facilityName,
    required this.facilityLocation,
    required this.syncDeltaMinutes,
    required this.selfTruck,
    required this.partnerTruck,
    required this.adviceText,
    required this.status,
  });
}
