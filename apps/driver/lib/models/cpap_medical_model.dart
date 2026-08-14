class SleepSessionData {
  final DateTime date;
  final double durationHours;
  final double ahiScore; // Apnea-Hypopnea Index (events per hour). < 5 is good.
  final double maskLeakLitersPerMin;
  final bool isCompliant;

  SleepSessionData({
    required this.date,
    required this.durationHours,
    required this.ahiScore,
    required this.maskLeakLitersPerMin,
    required this.isCompliant,
  });
}

class CpapMedicalProfile {
  final String status; // "Syncing Bluetooth CPAP...", "DOT Medical Card Certified"
  final bool isDotCompliant;
  final double compliancePercentage30Days; // DOT requires 70% usage (4+ hours a night)
  final String? certificateHash;
  final List<SleepSessionData> recentSessions;

  CpapMedicalProfile({
    required this.status,
    required this.isDotCompliant,
    required this.compliancePercentage30Days,
    this.certificateHash,
    required this.recentSessions,
  });
}
