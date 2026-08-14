class DroneMission {
  final String missionId;
  final String droneId;
  final String deliveryAddress;
  final String recipientName;
  final double distanceMiles;
  final double payloadWeightLbs;
  final String status; // "Ready to Launch", "In Transit", "Delivered", "Returning"
  final int estimatedMinutes;
  final double batteryPercentage;

  DroneMission({
    required this.missionId,
    required this.droneId,
    required this.deliveryAddress,
    required this.recipientName,
    required this.distanceMiles,
    required this.payloadWeightLbs,
    required this.status,
    required this.estimatedMinutes,
    required this.batteryPercentage,
  });
}
