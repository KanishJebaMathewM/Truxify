import 'dart:async';
import '../models/ev_optimizer_model.dart';

class EvOptimizerService {
  final _sessionController = StreamController<EvRoutingSession>.broadcast();

  Stream<EvRoutingSession> get routingStream => _sessionController.stream;

  void simulateEvRouting() async {
    // 1. Initial State (Good charge)
    _sessionController.add(EvRoutingSession(
      currentSocPct: 82.0,
      payloadWeightLbs: 65000.0,
      projectedRangeMiles: 285.0,
      status: 'Cruising - Nominal Energy Burn',
      nextCharger: null,
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Heavy load + Hills drains battery faster than expected
    _sessionController.add(EvRoutingSession(
      currentSocPct: 45.0,
      payloadWeightLbs: 65000.0,
      projectedRangeMiles: 110.0, // Dropped sharply
      status: 'High Burn Rate Detected (Topography/Payload)',
      nextCharger: null,
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Charger Reserved
    _sessionController.add(EvRoutingSession(
      currentSocPct: 43.5,
      payloadWeightLbs: 65000.0,
      projectedRangeMiles: 105.0,
      status: 'MEGAWATT CHARGER BAY RESERVED',
      nextCharger: EvChargerLocation(
        stationName: 'ElectraFi Heavy Duty Hub',
        address: 'I-80 Exit 22, PA',
        distanceMiles: 65.2, // Within safe range
        chargerType: '1.2 Megawatt MCS', // Fast commercial charger
        availableBays: 1,
        isReserved: true,
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
