class SecurityThreat {
  final DateTime detectionTime;
  final String objectType; // "Human Signature", "Vehicle"
  final double distanceToTrailerFeet;
  final String threatLevel; // "Low", "Elevated", "Critical"

  SecurityThreat({
    required this.detectionTime,
    required this.objectType,
    required this.distanceToTrailerFeet,
    required this.threatLevel,
  });
}

class DroneSecuritySession {
  final String status; // "Sentry Deployed", "THREAT DETECTED"
  final String locationRisk; // "High-Crime Cargo Area (Memphis, TN)"
  final double droneAltitudeFeet;
  final String cameraMode; // "FLIR Night Vision", "Optical"
  final bool isAlarmActive;
  final List<SecurityThreat> activeThreats;

  DroneSecuritySession({
    required this.status,
    required this.locationRisk,
    required this.droneAltitudeFeet,
    required this.cameraMode,
    required this.isAlarmActive,
    required this.activeThreats,
  });
}
