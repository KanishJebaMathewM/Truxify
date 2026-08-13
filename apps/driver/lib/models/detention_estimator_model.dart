class FacilityDetentionStats {
  final String facilityName;
  final String location;
  final double averageWaitHours;
  final int totalGeofenceVisits;
  final String trend; // "Improving", "Worsening"

  FacilityDetentionStats({
    required this.facilityName,
    required this.location,
    required this.averageWaitHours,
    required this.totalGeofenceVisits,
    required this.trend,
  });
}

class DetentionEstimatorSession {
  final String status;
  final List<FacilityDetentionStats> facilities;

  DetentionEstimatorSession({
    required this.status,
    required this.facilities,
  });
}
