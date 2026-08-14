import 'dart:async';
import '../models/black_ice_model.dart';

class BlackIceService {
  final _sessionController = StreamController<BlackIceSession>.broadcast();

  Stream<BlackIceSession> get thermalStream => _sessionController.stream;

  void simulateBridgeApproach() async {
    // 1. Normal Highway Scanning
    _sessionController.add(BlackIceSession(
      status: 'FLIR Thermal Camera Active',
      isIceDetected: false,
      ambientTempF: 34.0,
      recommendedSpeedMph: 65.0,
      thermalScanData: [
        ThermalPoint(50, 36.5),
        ThermalPoint(150, 36.2),
        ThermalPoint(300, 36.0),
        ThermalPoint(500, 36.1),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Approaching Overpass (Thermal Drop)
    _sessionController.add(BlackIceSession(
      status: 'WARNING: THERMAL ANOMALY AHEAD',
      isIceDetected: true, // Ice detected at 500ft
      ambientTempF: 34.0,
      recommendedSpeedMph: 45.0,
      thermalScanData: [
        ThermalPoint(50, 36.0),
        ThermalPoint(150, 35.8),
        ThermalPoint(300, 34.1),
        ThermalPoint(500, 28.5), // Freezing bridge deck
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. Imminent Black Ice
    _sessionController.add(BlackIceSession(
      status: 'DECELERATE IMMEDIATELY: BLACK ICE',
      isIceDetected: true,
      ambientTempF: 34.0,
      recommendedSpeedMph: 25.0, // Crawl speed
      thermalScanData: [
        ThermalPoint(50, 34.2),
        ThermalPoint(150, 28.5), // Ice is very close
        ThermalPoint(300, 28.0),
        ThermalPoint(500, 27.8),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
