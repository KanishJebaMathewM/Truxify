import 'dart:async';
import '../models/freight_claims_model.dart';

class FreightClaimsService {
  final _sessionController = StreamController<FreightClaimSession>.broadcast();

  Stream<FreightClaimSession> get forensicsStream => _sessionController.stream;

  void simulateClaimAnalysis() async {
    final loadId = 'BOL-X892-D';
    final claimAmount = 4500.00;
    
    // 1. Claim hits, starting analysis
    _sessionController.add(FreightClaimSession(
      loadId: loadId,
      claimAmountDollars: claimAmount,
      claimReason: 'Shifted/Damaged Pallets on Arrival',
      status: 'Analyzing Pre-Trip Departure Photos...',
      forensics: null,
      legalDefenseSummary: 'Awaiting AI analysis...',
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Metadata extraction
    final forensics = ImageForensics(
      imageHash: '0x8F3A2...C9B1',
      captureTimestamp: DateTime.now().subtract(const Duration(hours: 48)),
      gpsLocation: 'Shipper Dock 4, Chicago, IL',
      isMetadataAuthentic: true,
      securementStrapsDetected: 4,
      loadBarsDetected: 2,
      loadDistributionScore: 92.5,
    );
    
    _sessionController.add(FreightClaimSession(
      loadId: loadId,
      claimAmountDollars: claimAmount,
      claimReason: 'Shifted/Damaged Pallets on Arrival',
      status: 'Authenticating Metadata & Securement...',
      forensics: forensics,
      legalDefenseSummary: 'Extracting GPS, Timestamps, and Straps...',
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. Driver Cleared
    _sessionController.add(FreightClaimSession(
      loadId: loadId,
      claimAmountDollars: claimAmount,
      claimReason: 'Shifted/Damaged Pallets on Arrival',
      status: 'DRIVER CLEARED - CLAIM REJECTED',
      forensics: forensics,
      legalDefenseSummary: 'AI confirms 4 straps and 2 load bars were properly installed prior to departure. Metadata is authentic. Cargo damage is due to improper shrink-wrapping by shipper. Liability shifted to Shipper.',
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
