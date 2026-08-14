import 'dart:async';
import '../models/autonomous_yard_handoff_model.dart';

class AutonomousYardHandoffService {
  final _sessionController = StreamController<YardHandoffSession>.broadcast();

  Stream<YardHandoffSession> get handoffStream => _sessionController.stream;

  void simulateHandoff() async {
    // 1. Initial Arrival at Gate
    _sessionController.add(YardHandoffSession(
      facilityName: 'Amazon Fulfillment Center - DFW8',
      dropZoneGate: 'Zone Alpha - Slot 04',
      sessionStatus: 'Awaiting Arrival at Drop Zone',
      estimatedTimeSavedMinutes: 45,
      yardDog: null,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Driver arrives, autonomous yard dog dispatched
    _sessionController.add(YardHandoffSession(
      facilityName: 'Amazon Fulfillment Center - DFW8',
      dropZoneGate: 'Zone Alpha - Slot 04',
      sessionStatus: 'Handoff in Progress',
      estimatedTimeSavedMinutes: 45,
      yardDog: YardDogTelemetry(
        botId: 'EV-YARD-BOT-42',
        status: 'Approaching Drop Zone',
        batteryPct: 88.5,
        assignedDock: 'Dock Door #114',
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 4));
    
    // 3. Yard dog connects
    _sessionController.add(YardHandoffSession(
      facilityName: 'Amazon Fulfillment Center - DFW8',
      dropZoneGate: 'Zone Alpha - Slot 04',
      sessionStatus: 'Handoff in Progress',
      estimatedTimeSavedMinutes: 45,
      yardDog: YardDogTelemetry(
        botId: 'EV-YARD-BOT-42',
        status: 'Connecting to Trailer',
        batteryPct: 88.4,
        assignedDock: 'Dock Door #114',
      ),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 4. Handoff complete
    _sessionController.add(YardHandoffSession(
      facilityName: 'Amazon Fulfillment Center - DFW8',
      dropZoneGate: 'Zone Alpha - Slot 04',
      sessionStatus: 'Handoff Complete - Clear to Leave',
      estimatedTimeSavedMinutes: 45,
      yardDog: YardDogTelemetry(
        botId: 'EV-YARD-BOT-42',
        status: 'En Route to Dock',
        batteryPct: 88.0,
        assignedDock: 'Dock Door #114',
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
