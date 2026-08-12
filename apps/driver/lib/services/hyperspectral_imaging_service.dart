import 'dart:async';
import '../models/hyperspectral_imaging_model.dart';

class HyperspectralImagingService {
  final _sessionController = StreamController<HyperspectralSession>.broadcast();

  Stream<HyperspectralSession> get scannerStream => _sessionController.stream;

  void simulateProduceScan() async {
    // 1. Initial Scanning
    _sessionController.add(HyperspectralSession(
      status: 'Isolating Non-Visible Light Bands...',
      isScanning: true,
      analysis: null,
      forensicHash: null,
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Analyzing Cellular Data
    _sessionController.add(HyperspectralSession(
      status: 'Analyzing Cellular H2O and Chlorophyll...',
      isScanning: true,
      analysis: ProduceAnalysis(
        commodity: 'California Strawberries',
        waterContentPercent: 88.5,
        chlorophyllDegradationIndex: 12.0, // Low degradation
        internalBruisingPercent: 1.5,
        freshnessGrade: 'A - Peak Freshness',
        isClaimRisk: false,
      ),
      forensicHash: null,
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Scan Locked and Hashed
    _sessionController.add(HyperspectralSession(
      status: 'BASELINE FRESHNESS CRYPTOGRAPHICALLY SEALED',
      isScanning: false,
      analysis: ProduceAnalysis(
        commodity: 'California Strawberries',
        waterContentPercent: 88.5,
        chlorophyllDegradationIndex: 12.0,
        internalBruisingPercent: 1.5,
        freshnessGrade: 'A - Peak Freshness',
        isClaimRisk: false,
      ),
      forensicHash: 'SHA256: 9f86d081884c7d659a2feaa0c55ad015',
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
