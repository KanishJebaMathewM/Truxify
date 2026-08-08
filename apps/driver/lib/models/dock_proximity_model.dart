class IotTransponderSignal {
  final String entityId;
  final String entityType; // 'Forklift', 'Pedestrian', 'Pallet Jack'
  final double distanceMeters;
  final double approachSpeedMs;
  final double angleDegrees; // Relative to back of truck
  final bool isInBlindSpot;

  IotTransponderSignal({
    required this.entityId,
    required this.entityType,
    required this.distanceMeters,
    required this.approachSpeedMs,
    required this.angleDegrees,
    required this.isInBlindSpot,
  });

  bool get isCriticalWarning => distanceMeters < 3.0 && isInBlindSpot;
  bool get isCautionWarning => distanceMeters < 8.0;
}
