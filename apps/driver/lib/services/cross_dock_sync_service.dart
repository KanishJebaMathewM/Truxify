import 'dart:async';
import '../models/cross_dock_sync_model.dart';

class CrossDockSyncService {
  final _sessionController = StreamController<CrossDockSession>.broadcast();

  Stream<CrossDockSession> get syncStream => _sessionController.stream;

  void simulateNetworkSync() async {
    // 1. Normal Routing
    _sessionController.add(CrossDockSession(
      status: 'Tracking Inbound Fleet ETA...',
      targetTerminal: 'Memphis Super-Hub (MEM1)',
      synchronizedEta: '14:30 EST',
      recommendedSpeedMph: 65.0,
      isSpeedAdjusted: false,
      networkTrucks: [
        InboundTruck(truckId: 'TRK-104 (You)', origin: 'Nashville, TN', currentSpeedMph: 65.0, eta: '14:30', isDelayed: false),
        InboundTruck(truckId: 'TRK-992', origin: 'Little Rock, AR', currentSpeedMph: 62.0, eta: '14:30', isDelayed: false),
        InboundTruck(truckId: 'TRK-411', origin: 'Jackson, MS', currentSpeedMph: 68.0, eta: '14:30', isDelayed: false),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Delay Detected
    _sessionController.add(CrossDockSession(
      status: 'WEATHER DELAY DETECTED ON TRK-411',
      targetTerminal: 'Memphis Super-Hub (MEM1)',
      synchronizedEta: '14:30 EST',
      recommendedSpeedMph: 65.0,
      isSpeedAdjusted: false,
      networkTrucks: [
        InboundTruck(truckId: 'TRK-104 (You)', origin: 'Nashville, TN', currentSpeedMph: 65.0, eta: '14:30', isDelayed: false),
        InboundTruck(truckId: 'TRK-992', origin: 'Little Rock, AR', currentSpeedMph: 62.0, eta: '14:30', isDelayed: false),
        InboundTruck(truckId: 'TRK-411', origin: 'Jackson, MS', currentSpeedMph: 45.0, eta: '15:15', isDelayed: true), // Heavy rain
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Network Resync
    _sessionController.add(CrossDockSession(
      status: 'SYNCHRONIZING NETWORK: SLOW DOWN TO SAVE FUEL',
      targetTerminal: 'Memphis Super-Hub (MEM1)',
      synchronizedEta: '15:15 EST', // Pushed back to match the delayed truck
      recommendedSpeedMph: 52.0, // Slow down
      isSpeedAdjusted: true,
      networkTrucks: [
        InboundTruck(truckId: 'TRK-104 (You)', origin: 'Nashville, TN', currentSpeedMph: 52.0, eta: '15:15', isDelayed: false),
        InboundTruck(truckId: 'TRK-992', origin: 'Little Rock, AR', currentSpeedMph: 50.0, eta: '15:15', isDelayed: false),
        InboundTruck(truckId: 'TRK-411', origin: 'Jackson, MS', currentSpeedMph: 45.0, eta: '15:15', isDelayed: true),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
