class DroneTelemetry {
  final String droneId;
  final String status; // 'Deployed', 'Returning', 'Docked'
  final double distanceToTruck; // meters
  final String predictedRendezvousGps;
  final int timeToRendezvousSec;
  final int batteryPercent;

  DroneTelemetry({
    required this.droneId,
    required this.status,
    required this.distanceToTruck,
    required this.predictedRendezvousGps,
    required this.timeToRendezvousSec,
    required this.batteryPercent,
  });
}
