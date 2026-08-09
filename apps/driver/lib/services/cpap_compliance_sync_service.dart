import 'dart:async';
import '../models/cpap_compliance_sync_model.dart';

class CpapComplianceSyncService {
  Future<CpapComplianceReport> syncBluetoothData() async {
    // Simulate Bluetooth pairing and data transfer
    await Future.delayed(const Duration(seconds: 3));

    final today = DateTime.now();
    
    return CpapComplianceReport(
      machineName: 'ResMed AirSense 11',
      complianceStatus: 'Compliant',
      thirtyDayCompliancePct: 88.5,
      recentLogs: [
        CpapUsageLog(date: today.subtract(const Duration(days: 1)), hoursUsed: 7.2, ahiEventsPerHr: 2, isCompliant: true),
        CpapUsageLog(date: today.subtract(const Duration(days: 2)), hoursUsed: 6.8, ahiEventsPerHr: 1, isCompliant: true),
        CpapUsageLog(date: today.subtract(const Duration(days: 3)), hoursUsed: 3.5, ahiEventsPerHr: 4, isCompliant: false), // Under 4 hours
        CpapUsageLog(date: today.subtract(const Duration(days: 4)), hoursUsed: 8.1, ahiEventsPerHr: 2, isCompliant: true),
        CpapUsageLog(date: today.subtract(const Duration(days: 5)), hoursUsed: 7.5, ahiEventsPerHr: 3, isCompliant: true),
      ],
    );
  }
}
