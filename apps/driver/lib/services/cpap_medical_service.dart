import 'dart:async';
import '../models/cpap_medical_model.dart';

class CpapMedicalService {
  final _profileController = StreamController<CpapMedicalProfile>.broadcast();

  Stream<CpapMedicalProfile> get profileStream => _profileController.stream;

  void simulateCpapSync() async {
    // 1. Initial scanning state
    _profileController.add(CpapMedicalProfile(
      status: 'Scanning for Bluetooth CPAP...',
      isDotCompliant: false,
      compliancePercentage30Days: 0.0,
      certificateHash: null,
      recentSessions: [],
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Syncing data
    _profileController.add(CpapMedicalProfile(
      status: 'Syncing ResMed AirSense 11...',
      isDotCompliant: false,
      compliancePercentage30Days: 0.0,
      certificateHash: null,
      recentSessions: [
        SleepSessionData(date: DateTime.now().subtract(const Duration(days: 1)), durationHours: 7.2, ahiScore: 1.4, maskLeakLitersPerMin: 2.0, isCompliant: true),
        SleepSessionData(date: DateTime.now().subtract(const Duration(days: 2)), durationHours: 6.8, ahiScore: 2.1, maskLeakLitersPerMin: 1.5, isCompliant: true),
        SleepSessionData(date: DateTime.now().subtract(const Duration(days: 3)), durationHours: 8.1, ahiScore: 0.9, maskLeakLitersPerMin: 0.0, isCompliant: true),
        SleepSessionData(date: DateTime.now().subtract(const Duration(days: 4)), durationHours: 3.2, ahiScore: 8.5, maskLeakLitersPerMin: 24.0, isCompliant: false), // Bad night, mask leak
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. Certified
    _profileController.add(CpapMedicalProfile(
      status: 'DOT MEDICAL CLEARANCE SECURED',
      isDotCompliant: true,
      compliancePercentage30Days: 92.5, // Well above 70% requirement
      certificateHash: 'fmcsa_cert_99a8b7c6',
      recentSessions: [
        SleepSessionData(date: DateTime.now().subtract(const Duration(days: 1)), durationHours: 7.2, ahiScore: 1.4, maskLeakLitersPerMin: 2.0, isCompliant: true),
        SleepSessionData(date: DateTime.now().subtract(const Duration(days: 2)), durationHours: 6.8, ahiScore: 2.1, maskLeakLitersPerMin: 1.5, isCompliant: true),
        SleepSessionData(date: DateTime.now().subtract(const Duration(days: 3)), durationHours: 8.1, ahiScore: 0.9, maskLeakLitersPerMin: 0.0, isCompliant: true),
        SleepSessionData(date: DateTime.now().subtract(const Duration(days: 4)), durationHours: 3.2, ahiScore: 8.5, maskLeakLitersPerMin: 24.0, isCompliant: false),
      ],
    ));
  }

  void dispose() {
    _profileController.close();
  }
}
