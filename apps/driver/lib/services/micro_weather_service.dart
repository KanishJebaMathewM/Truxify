import 'dart:async';
import '../models/micro_weather_model.dart';

class MicroWeatherService {
  final _sessionController = StreamController<MicroWeatherSession>.broadcast();

  Stream<MicroWeatherSession> get weatherStream => _sessionController.stream;

  void simulateWeatherEvent() async {
    // 1. Clear weather
    _sessionController.add(MicroWeatherSession(
      status: 'P2P Mesh Network Active',
      isHazardDetected: false,
      hazardType: null,
      recommendedSpeedMph: 65.0,
      peerData: [
        PeerTelemetry(truckId: 'TRK-912', distanceAheadMiles: 1.2, wiperSpeed: 0, isTractionControlActive: false, ambientTempF: 75.0),
        PeerTelemetry(truckId: 'TRK-443', distanceAheadMiles: 3.5, wiperSpeed: 0, isTractionControlActive: false, ambientTempF: 74.8),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Distant truck hits rain
    _sessionController.add(MicroWeatherSession(
      status: 'ANALYZING PEER TELEMETRY ANOMALY...',
      isHazardDetected: false,
      hazardType: null,
      recommendedSpeedMph: 65.0,
      peerData: [
        PeerTelemetry(truckId: 'TRK-912', distanceAheadMiles: 1.0, wiperSpeed: 0, isTractionControlActive: false, ambientTempF: 75.0),
        PeerTelemetry(truckId: 'TRK-443', distanceAheadMiles: 3.2, wiperSpeed: 3, isTractionControlActive: false, ambientTempF: 68.0), // Wipers maxed, temp dropped
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Hazard declared
    _sessionController.add(MicroWeatherSession(
      status: 'HAZARD AHEAD: FLASH FLOOD / MICRO-BURST',
      isHazardDetected: true,
      hazardType: 'Severe Hydroplaning Risk',
      recommendedSpeedMph: 45.0, // Slow down
      peerData: [
        PeerTelemetry(truckId: 'TRK-912', distanceAheadMiles: 0.8, wiperSpeed: 3, isTractionControlActive: true, ambientTempF: 67.5), // Close truck hit it and is slipping
        PeerTelemetry(truckId: 'TRK-443', distanceAheadMiles: 3.0, wiperSpeed: 3, isTractionControlActive: true, ambientTempF: 68.0),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
