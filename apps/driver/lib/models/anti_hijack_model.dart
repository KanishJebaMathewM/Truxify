class SecurityTelemetry {
  final bool engineStarted;
  final bool geofenceBreached;
  final bool isDriverAuthorized; // e.g. biometric check passed
  final String trailerBrakeStatus; // "Pressurized (Free)", "Air Dumped (Locked)"
  final String kingpinStatus; // "Unlocked", "Deadbolt Engaged"

  SecurityTelemetry({
    required this.engineStarted,
    required this.geofenceBreached,
    required this.isDriverAuthorized,
    required this.trailerBrakeStatus,
    required this.kingpinStatus,
  });
}

class AntiHijackSession {
  final String loadId;
  final String cargoType;
  final String status; // "Secured in Geofence", "Unauthorized Engine Start Detected", "Trailer Immobilized"
  final SecurityTelemetry telemetry;

  AntiHijackSession({
    required this.loadId,
    required this.cargoType,
    required this.status,
    required this.telemetry,
  });
}
