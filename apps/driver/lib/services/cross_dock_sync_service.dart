import 'dart:async';
import '../models/cross_dock_sync_model.dart';

class CrossDockSyncService {
  final _sessionController = StreamController<CrossDockSession>.broadcast();

  Stream<CrossDockSession> get syncStream => _sessionController.stream;

  void simulateSynchronization() async {
    // 1. Out of Sync: Self is arriving 45 mins early
    _sessionController.add(CrossDockSession(
      facilityName: 'Dallas X-Dock Hub',
      facilityLocation: 'Dock Door 42',
      syncDeltaMinutes: 45,
      status: 'Out of Sync',
      adviceText: 'You are arriving 45 minutes ahead of the outbound truck. Reduce speed to save fuel and prevent dock congestion.',
      selfTruck: TruckTelemetry(truckId: 'TRX-Self (You)', role: 'Inbound', distanceToDockMiles: 120.0, estimatedArrivalMinutes: 110, currentSpeedMph: 65.0, targetSpeedMph: 45.0),
      partnerTruck: TruckTelemetry(truckId: 'TRX-Prtnr-B', role: 'Outbound', distanceToDockMiles: 155.0, estimatedArrivalMinutes: 155, currentSpeedMph: 60.0, targetSpeedMph: 60.0),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Synchronizing: Driver slowed down to 45 mph
    _sessionController.add(CrossDockSession(
      facilityName: 'Dallas X-Dock Hub',
      facilityLocation: 'Dock Door 42',
      syncDeltaMinutes: 15,
      status: 'Synchronizing',
      adviceText: 'ETA delta reducing. Maintain current speed of 45 MPH.',
      selfTruck: TruckTelemetry(truckId: 'TRX-Self (You)', role: 'Inbound', distanceToDockMiles: 90.0, estimatedArrivalMinutes: 120, currentSpeedMph: 45.0, targetSpeedMph: 45.0),
      partnerTruck: TruckTelemetry(truckId: 'TRX-Prtnr-B', role: 'Outbound', distanceToDockMiles: 130.0, estimatedArrivalMinutes: 135, currentSpeedMph: 60.0, targetSpeedMph: 60.0),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 3. Perfect Sync achieved
    _sessionController.add(CrossDockSession(
      facilityName: 'Dallas X-Dock Hub',
      facilityLocation: 'Dock Door 42',
      syncDeltaMinutes: 0,
      status: 'Perfect Sync',
      adviceText: 'JIT Sync Achieved. Both trucks will arrive at the exact same minute.',
      selfTruck: TruckTelemetry(truckId: 'TRX-Self (You)', role: 'Inbound', distanceToDockMiles: 50.0, estimatedArrivalMinutes: 60, currentSpeedMph: 50.0, targetSpeedMph: 50.0),
      partnerTruck: TruckTelemetry(truckId: 'TRX-Prtnr-B', role: 'Outbound', distanceToDockMiles: 60.0, estimatedArrivalMinutes: 60, currentSpeedMph: 60.0, targetSpeedMph: 60.0),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
