class CpapUsageLog {
  final DateTime date;
  final double hoursUsed;
  final int ahiEventsPerHr; // Apnea-Hypopnea Index
  final bool isCompliant;

  CpapUsageLog({
    required this.date,
    required this.hoursUsed,
    required this.ahiEventsPerHr,
    required this.isCompliant,
  });
}

class CpapComplianceReport {
  final String machineName;
  final String complianceStatus; // "Compliant" or "Action Required"
  final double thirtyDayCompliancePct; // Needs to be >= 70% usually
  final List<CpapUsageLog> recentLogs;

  CpapComplianceReport({
    required this.machineName,
    required this.complianceStatus,
    required this.thirtyDayCompliancePct,
    required this.recentLogs,
  });
}
