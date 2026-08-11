import 'dart:async';
import '../models/accessorial_charge_model.dart';

class ChargeResolutionService {
  Future<List<AccessorialCharge>> getPendingCharges() async {
    await Future.delayed(const Duration(milliseconds: 500));
    
    return [
      AccessorialCharge(
        chargeId: 'CHG-9921',
        loadId: 'LD-4002',
        chargeType: 'Detention',
        amount: 150.00,
        evidenceUrl: 'gps_log_0422.json',
        aiStatus: 'Pending AI Review',
        confidenceReason: 'Waiting for AI analysis of geofence timestamps.',
      ),
      AccessorialCharge(
        chargeId: 'CHG-9922',
        loadId: 'LD-4005',
        chargeType: 'Lumper',
        amount: 250.00,
        evidenceUrl: 'receipt_scan.jpg',
        aiStatus: 'Pending AI Review',
        confidenceReason: 'Waiting for OCR extraction of receipt.',
      )
    ];
  }

  Future<AccessorialCharge> processChargeWithAI(AccessorialCharge charge) async {
    // Simulate AI processing time
    await Future.delayed(const Duration(seconds: 3));
    
    if (charge.chargeType == 'Detention') {
      return AccessorialCharge(
        chargeId: charge.chargeId,
        loadId: charge.loadId,
        chargeType: charge.chargeType,
        amount: charge.amount,
        evidenceUrl: charge.evidenceUrl,
        aiStatus: 'Approved by AI',
        confidenceReason: 'GPS data confirmed 3h 15m dwell time. Contract allows max 2h free time. \$150 approved.',
      );
    } else {
      return AccessorialCharge(
        chargeId: charge.chargeId,
        loadId: charge.loadId,
        chargeType: charge.chargeType,
        amount: charge.amount,
        evidenceUrl: charge.evidenceUrl,
        aiStatus: 'Approved by AI',
        confidenceReason: 'OCR successfully matched receipt amount (\$250) and vendor name. Contract allows lumper pass-through.',
      );
    }
  }
}
