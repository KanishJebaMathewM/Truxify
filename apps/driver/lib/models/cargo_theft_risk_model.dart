class ThreatZone {
  final String locationName;
  final double latitude;
  final double longitude;
  final String riskLevel; // 'Low', 'Medium', 'High', 'Critical'
  final List<String> recentIncidents;
  final String intelSource;

  ThreatZone({
    required this.locationName,
    required this.latitude,
    required this.longitude,
    required this.riskLevel,
    required this.recentIncidents,
    required this.intelSource,
  });
}
