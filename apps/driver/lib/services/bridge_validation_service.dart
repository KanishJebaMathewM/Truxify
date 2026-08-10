import 'dart:async';
import '../models/bridge_validation_model.dart';

class BridgeValidationService {
  final _sessionController = StreamController<BridgeValidationSession>.broadcast();

  Stream<BridgeValidationSession> get validationStream => _sessionController.stream;

  void simulateBridgeValidation() async {
    final truckWeight = 78500; // Fully loaded

    // 1. Scanning
    _sessionController.add(BridgeValidationSession(
      truckGrossWeightLbs: truckWeight,
      status: 'Scanning Municipal Infrastructure...',
      nextBridge: null,
      isSafeToCross: true,
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Approaching safe bridge
    _sessionController.add(BridgeValidationSession(
      truckGrossWeightLbs: truckWeight,
      status: 'Highway Bridge - Certified',
      nextBridge: BridgeInfrastructure(
        bridgeName: 'I-40 River Overpass',
        highwayRoute: 'Interstate 40',
        structuralLimitLbs: 120000, // Safe
        engineeringStatus: 'Certified',
      ),
      isSafeToCross: true,
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Reroute via rural backroad -> DANGER
    _sessionController.add(BridgeValidationSession(
      truckGrossWeightLbs: truckWeight,
      status: 'ROUTING BLOCKED - INFRASTRUCTURE HAZARD',
      nextBridge: BridgeInfrastructure(
        bridgeName: 'Old Mill Creek Bridge',
        highwayRoute: 'County Road 44',
        structuralLimitLbs: 40000, // Deficient!
        engineeringStatus: 'Structurally Deficient - Restrictions Apply',
      ),
      isSafeToCross: false,
      weightDeltaLbs: 38500, // Overweight by 38k lbs
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
