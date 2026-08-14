import 'dart:async';
import '../models/dock_proximity_model.dart';

class ForkliftIotService {
  Stream<List<IotTransponderSignal>> streamDockEnvironment() async* {
    // Simulate approaching the dock with moving forklifts
    
    // State 1: Approaching, clear
    yield [
      IotTransponderSignal(entityId: 'FL-01', entityType: 'Forklift', distanceMeters: 15.0, approachSpeedMs: 0.5, angleDegrees: 45, isInBlindSpot: false),
    ];
    await Future.delayed(const Duration(seconds: 2));

    // State 2: Caution, forklift getting closer
    yield [
      IotTransponderSignal(entityId: 'FL-01', entityType: 'Forklift', distanceMeters: 7.5, approachSpeedMs: 1.2, angleDegrees: 15, isInBlindSpot: true),
      IotTransponderSignal(entityId: 'PED-99', entityType: 'Pedestrian', distanceMeters: 12.0, approachSpeedMs: 0.2, angleDegrees: -40, isInBlindSpot: false),
    ];
    await Future.delayed(const Duration(seconds: 2));

    // State 3: CRITICAL DANGER
    yield [
      IotTransponderSignal(entityId: 'FL-01', entityType: 'Forklift', distanceMeters: 2.1, approachSpeedMs: 2.5, angleDegrees: 5, isInBlindSpot: true), // Imminent collision in blind spot
      IotTransponderSignal(entityId: 'PED-99', entityType: 'Pedestrian', distanceMeters: 11.0, approachSpeedMs: 0.2, angleDegrees: -45, isInBlindSpot: false),
    ];
  }
}
