import 'dart:async';
import '../models/platoon_drafting_model.dart';

class PlatoonDraftingService {
  final _sessionController = StreamController<PlatoonSession>.broadcast();

  Stream<PlatoonSession> get platoonStream => _sessionController.stream;

  void simulatePlatooning() async {
    // 1. Searching
    _sessionController.add(PlatoonSession(
      status: 'Scanning Highway for Truxify Convoys...',
      isPlatoonActive: false,
      aerodynamicFuelSavingsPercent: 0.0,
      leadTruck: null,
      selfTruck: PlatoonTruck(
        truckId: 'Self (Unit 994)',
        followingDistanceFeet: 0.0,
        currentSpeedMph: 65.0,
        brakeSyncLatencyMs: 0.0,
      ),
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Establishing Sync
    _sessionController.add(PlatoonSession(
      status: 'V2V Handshake in Progress...',
      isPlatoonActive: false,
      aerodynamicFuelSavingsPercent: 0.0,
      leadTruck: PlatoonTruck(
        truckId: 'Lead (Unit 409)',
        followingDistanceFeet: 150.0,
        currentSpeedMph: 65.0,
        brakeSyncLatencyMs: 8.5,
      ),
      selfTruck: PlatoonTruck(
        truckId: 'Self (Unit 994)',
        followingDistanceFeet: 150.0,
        currentSpeedMph: 67.0, // Closing the gap
        brakeSyncLatencyMs: 8.5,
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Active Platooning
    _sessionController.add(PlatoonSession(
      status: 'AUTONOMOUS PLATOON DRAFTING ACTIVE',
      isPlatoonActive: true,
      aerodynamicFuelSavingsPercent: 12.5, // 12.5% fuel savings from drafting
      leadTruck: PlatoonTruck(
        truckId: 'Lead (Unit 409)',
        followingDistanceFeet: 35.0,
        currentSpeedMph: 65.0,
        brakeSyncLatencyMs: 2.1, // Ultra-low latency V2V braking
      ),
      selfTruck: PlatoonTruck(
        truckId: 'Self (Unit 994)',
        followingDistanceFeet: 35.0, // Extremely close following distance made safe by AI
        currentSpeedMph: 65.0,
        brakeSyncLatencyMs: 2.1,
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
