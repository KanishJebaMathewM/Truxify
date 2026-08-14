import 'dart:async';
import '../models/wildlife_ar_model.dart';

class WildlifeArService {
  final _sessionController = StreamController<WildlifeArSession>.broadcast();

  Stream<WildlifeArSession> get arStream => _sessionController.stream;

  void simulateNightDrive() async {
    // 1. Cruising, clear road
    _sessionController.add(WildlifeArSession(
      status: 'FLIR Thermal Camera Active - Clear',
      vehicleSpeedMph: 65.0,
      isNightMode: true,
      isBrakingSuggested: false,
      activeSignatures: [],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Distant deer detected off the road
    _sessionController.add(WildlifeArSession(
      status: 'MAMMAL SIGNATURE DETECTED IN DITCH',
      vehicleSpeedMph: 65.0,
      isNightMode: true,
      isBrakingSuggested: false,
      activeSignatures: [
        ThermalSignature(objectClass: 'Deer', distanceFeet: 800.0, trajectoryAngle: 15.0, confidenceScore: 0.85),
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Moose running onto the road
    _sessionController.add(WildlifeArSession(
      status: 'CRITICAL THREAT: MOOSE ENTERING HIGHWAY',
      vehicleSpeedMph: 65.0,
      isNightMode: true,
      isBrakingSuggested: true,
      activeSignatures: [
        ThermalSignature(objectClass: 'Deer', distanceFeet: 500.0, trajectoryAngle: 15.0, confidenceScore: 0.88),
        ThermalSignature(objectClass: 'Moose', distanceFeet: 400.0, trajectoryAngle: 85.0, confidenceScore: 0.96), // Running straight into road
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
