import 'dart:async';
import '../models/dot_compliance_predictor_model.dart';

class DotCompliancePredictorService {
  Future<List<ComplianceDocument>> getComplianceStatus() async {
    await Future.delayed(const Duration(seconds: 1));
    
    return [
      ComplianceDocument(
        documentType: 'CDL Class A',
        expirationDate: DateTime.now().add(const Duration(days: 412)),
        isWarningActive: false,
        daysRemaining: 412,
      ),
      ComplianceDocument(
        documentType: 'Hazmat Endorsement',
        expirationDate: DateTime.now().add(const Duration(days: 280)),
        isWarningActive: false,
        daysRemaining: 280,
      ),
      ComplianceDocument(
        documentType: 'DOT Medical Card (Physical)',
        expirationDate: DateTime.now().add(const Duration(days: 14)), // CRITICAL WARNING
        isWarningActive: true,
        daysRemaining: 14,
        suggestedClinics: [
          ClinicOption(
            clinicName: 'Concentra Urgent Care',
            location: 'Exit 42 (I-80)',
            distanceMiles: 45.0,
            deviationFromRouteMiles: 1.2,
          ),
          ClinicOption(
            clinicName: 'Pilot Flying J DOT Clinic',
            location: 'Exit 101 (I-80)',
            distanceMiles: 120.0,
            deviationFromRouteMiles: 0.0,
          ),
        ],
      ),
    ];
  }

  Future<bool> bookAppointment(String clinicName) async {
    await Future.delayed(const Duration(seconds: 2));
    return true;
  }
}
