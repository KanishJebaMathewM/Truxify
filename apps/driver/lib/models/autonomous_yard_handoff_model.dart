class YardDogTelemetry {
  final String botId;
  final String status; // "Dispatched", "Approaching Drop Zone", "Connecting to Trailer", "En Route to Dock"
  final double batteryPct;
  final String assignedDock;

  YardDogTelemetry({
    required this.botId,
    required this.status,
    required this.batteryPct,
    required this.assignedDock,
  });
}

class YardHandoffSession {
  final String facilityName;
  final String dropZoneGate;
  final String sessionStatus; // "Awaiting Arrival", "Handoff in Progress", "Handoff Complete - Clear to Leave"
  final YardDogTelemetry? yardDog;
  final int estimatedTimeSavedMinutes;

  YardHandoffSession({
    required this.facilityName,
    required this.dropZoneGate,
    required this.sessionStatus,
    this.yardDog,
    required this.estimatedTimeSavedMinutes,
  });
}
