class DetentionSession {
  final String sessionId;
  final String facilityName;
  final DateTime geofenceEntryTime;
  final DateTime? geofenceExitTime;
  final int gracePeriodHours; // usually 2 hours
  final double hourlyDetentionRate; // e.g. $50/hr
  final bool isCurrentlyActive;

  DetentionSession({
    required this.sessionId,
    required this.facilityName,
    required this.geofenceEntryTime,
    this.geofenceExitTime,
    required this.gracePeriodHours,
    required this.hourlyDetentionRate,
    required this.isCurrentlyActive,
  });

  Duration get totalWaitTime {
    final end = geofenceExitTime ?? DateTime.now();
    return end.difference(geofenceEntryTime);
  }

  Duration get billableDetentionTime {
    final wait = totalWaitTime;
    final grace = Duration(hours: gracePeriodHours);
    if (wait > grace) {
      return wait - grace;
    }
    return Duration.zero;
  }

  double get accruedPay {
    final billableHours = billableDetentionTime.inMinutes / 60.0;
    return billableHours * hourlyDetentionRate;
  }
}
