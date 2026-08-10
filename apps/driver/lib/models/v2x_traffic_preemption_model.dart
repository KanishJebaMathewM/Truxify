class TrafficIntersection {
  final String intersectionId;
  final String name;
  final double distanceFeet;
  final String currentLightState; // "Green", "Yellow", "Red"
  final int secondsUntilChange;
  
  TrafficIntersection({
    required this.intersectionId,
    required this.name,
    required this.distanceFeet,
    required this.currentLightState,
    required this.secondsUntilChange,
  });
}

class V2XPreemptionStatus {
  final bool isV2XActive;
  final double vehicleWeightLbs;
  final double currentSpeedMph;
  final TrafficIntersection? upcomingIntersection;
  final bool isPreemptionRequested;
  final bool isPreemptionGranted;
  final String message;

  V2XPreemptionStatus({
    required this.isV2XActive,
    required this.vehicleWeightLbs,
    required this.currentSpeedMph,
    this.upcomingIntersection,
    required this.isPreemptionRequested,
    required this.isPreemptionGranted,
    required this.message,
  });
}
