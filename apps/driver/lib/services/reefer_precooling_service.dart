import 'dart:async';
import '../models/reefer_precooling_model.dart';

class ReeferPreCoolingService {
  final _sessionController = StreamController<PreCoolingSession>.broadcast();

  Stream<PreCoolingSession> get coolingStream => _sessionController.stream;

  void simulatePreCooling() async {
    // 1. Driving, far away (ETA > cooling time)
    _sessionController.add(PreCoolingSession(
      shipperName: 'ColdChain Logistics - Dallas',
      etaMinutes: 120, // 2 hours away
      autoSyncEnabled: true,
      telemetry: ReeferTelemetry(
        trailerId: 'TK-992-RF',
        currentTempF: 75.0, // Ambient temp
        targetTempF: -10.0, // Ice cream temp
        status: 'Idle - Monitoring ETA',
        timeToTargetMinutes: 45, // Takes 45 mins to cool down
      ),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Cooling trigger threshold reached
    _sessionController.add(PreCoolingSession(
      shipperName: 'ColdChain Logistics - Dallas',
      etaMinutes: 45, // Exactly matches cooling time
      autoSyncEnabled: true,
      telemetry: ReeferTelemetry(
        trailerId: 'TK-992-RF',
        currentTempF: 75.0,
        targetTempF: -10.0,
        status: 'Pre-cooling Active',
        timeToTargetMinutes: 45,
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Arriving at shipper
    _sessionController.add(PreCoolingSession(
      shipperName: 'ColdChain Logistics - Dallas',
      etaMinutes: 2, 
      autoSyncEnabled: true,
      telemetry: ReeferTelemetry(
        trailerId: 'TK-992-RF',
        currentTempF: -10.0,
        targetTempF: -10.0,
        status: 'Ready - Target Achieved',
        timeToTargetMinutes: 0,
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
