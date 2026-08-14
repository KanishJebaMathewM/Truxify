class AxleWeightReading {
  final String axleGroup; // "Steer", "Drive", "Trailer"
  final int dotLimitLbs;
  final int highwayWimReadingLbs;
  final int onboardTelemetryLbs;
  final bool isWimFalsePositive;

  AxleWeightReading({
    required this.axleGroup,
    required this.dotLimitLbs,
    required this.highwayWimReadingLbs,
    required this.onboardTelemetryLbs,
    required this.isWimFalsePositive,
  });
}

class WimSyncEvent {
  final String weighStationName;
  final double distanceToStationMiles;
  final List<AxleWeightReading> axleReadings;
  final String status; // "Approaching", "WIM Dispute Detected", "Bypass Granted"
  final String dotResponse;

  WimSyncEvent({
    required this.weighStationName,
    required this.distanceToStationMiles,
    required this.axleReadings,
    required this.status,
    required this.dotResponse,
  });
}
