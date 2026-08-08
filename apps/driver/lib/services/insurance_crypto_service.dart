import 'dart:async';
import '../models/telematics_insurance_model.dart';
import 'dart:convert';
import 'package:crypto/crypto.dart';

class InsuranceCryptoService {
  Future<TelematicsScore> getMonthlyScore() async {
    await Future.delayed(const Duration(seconds: 1)); // Simulate API call

    return TelematicsScore(
      score: 94,
      hardBrakingEvents: 2,
      speedingEvents: 0,
      hosComplianceRate: 99.8,
      reportPeriod: 'July 2026',
      projectedDiscountPercentage: 12.5,
    );
  }

  Future<CryptoInsuranceReport> generateAndSubmitReport(TelematicsScore score) async {
    // Simulate generating cryptographic proof
    await Future.delayed(const Duration(seconds: 2));

    final rawData = '${score.score}-${score.hardBrakingEvents}-${score.reportPeriod}-TRUXIFY-VERIFIED';
    final bytes = utf8.encode(rawData);
    final hash = sha256.convert(bytes);

    return CryptoInsuranceReport(
      reportId: 'REP-202607-99A',
      data: score,
      cryptographicHash: hash.toString(),
      submissionStatus: 'Successfully Transmitted to Progressive Insurance API',
    );
  }
}
