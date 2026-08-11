class DroneMission {
  final String droneId;
  final String parcelId;
  final String destinationAddress;
  final double distanceKm;
  final String status; // 'Deploying', 'In Flight', 'Delivered', 'Returning', 'Docked'
  final int batteryPercentage;
  final double estimatedTimeOfArrivalMins;
  final bool hasTelemetryError;

  DroneMission({
    required this.droneId,
    required this.parcelId,
    required this.destinationAddress,
    required this.distanceKm,
    required this.status,
    required this.batteryPercentage,
    required this.estimatedTimeOfArrivalMins,
    required this.hasTelemetryError,
  });
}

class MobileHubState {
  final String hubLocation;
  final bool isSafeLaunchZone;
  final int totalDronesAvailable;
  final int dronesInFlight;
  final int parcelsRemaining;

  MobileHubState({
    required this.hubLocation,
    required this.isSafeLaunchZone,
    required this.totalDronesAvailable,
    required this.dronesInFlight,
    required this.parcelsRemaining,
  });
}
