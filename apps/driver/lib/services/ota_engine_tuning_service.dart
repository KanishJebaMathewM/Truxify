import 'dart:async';
import '../models/ota_engine_tuning_model.dart';

class OtaEngineTuningService {
  final _sessionController = StreamController<OtaTuningSession>.broadcast();

  Stream<OtaTuningSession> get tuningStream => _sessionController.stream;

  void simulateTopographyChanges() async {
    // 1. Flat plains (Eco mode)
    _sessionController.add(OtaTuningSession(
      truckVin: '1M2P3...8X',
      status: 'Cruising (Optimal Fuel Efficiency)',
      ecm: EngineEcmState(
        activeTuneMap: 'Flatland Eco-Mode v2.1',
        currentGradePct: 0.5,
        maxTorqueLbFt: 1450,
        shiftPointRpm: 1250, // Shift early for fuel econ
        engineLoadPct: 35.0,
        nextTopographyEvent: 'Steep Grade (6%) in 1.2 miles',
      ),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Approaching mountains, OTA flash
    _sessionController.add(OtaTuningSession(
      truckVin: '1M2P3...8X',
      status: 'OTA ECM Map Flash in Progress...',
      ecm: EngineEcmState(
        activeTuneMap: 'Flatland Eco-Mode v2.1', // still active during flash
        currentGradePct: 2.0,
        maxTorqueLbFt: 1450,
        shiftPointRpm: 1250,
        engineLoadPct: 55.0,
        nextTopographyEvent: 'Approaching Rocky Mountains Grade',
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Mountain climbing (Max Torque)
    _sessionController.add(OtaTuningSession(
      truckVin: '1M2P3...8X',
      status: 'Mountain Map Active (Max Power)',
      ecm: EngineEcmState(
        activeTuneMap: 'Mountain Max Torque v1.4',
        currentGradePct: 6.5,
        maxTorqueLbFt: 1850, // Huge torque increase
        shiftPointRpm: 1750, // Hold gears longer
        engineLoadPct: 98.5, // Pulling hard
        nextTopographyEvent: 'Summit in 3.4 miles',
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
