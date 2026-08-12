import 'dart:async';
import '../models/engine_remapping_model.dart';

class EngineRemappingService {
  final _sessionController = StreamController<RemappingSession>.broadcast();

  Stream<RemappingSession> get mapStream => _sessionController.stream;

  void simulateTopologyChange() async {
    final ecoTune = EngineTune(
      profileName: 'Midwest Eco-Cruiser',
      maxHorsepower: 400,
      peakTorqueLbFt: 1450,
      jakeBrakeProfile: 'Low-Aggression',
      shiftingLogic: 'Early Up-shift (Fuel Save)',
    );

    final mountainTune = EngineTune(
      profileName: 'Rocky Mountain Hauler',
      maxHorsepower: 505,
      peakTorqueLbFt: 1850,
      jakeBrakeProfile: 'Max-Retardation',
      shiftingLogic: 'Hold Gears (Climb)',
    );

    // 1. Cruising Kansas
    _sessionController.add(RemappingSession(
      status: 'Active Tune: Maximum MPG',
      currentRegion: 'Kansas Interstate (Flat)',
      upcomingGradePercent: 0.5,
      activeTune: ecoTune,
      isFlashing: false,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Approaching Rockies, flashing ECM
    _sessionController.add(RemappingSession(
      status: 'TOPOLOGY SHIFT: OTA FIRMWARE FLASH IN PROGRESS...',
      currentRegion: 'Approaching Colorado Rockies',
      upcomingGradePercent: 6.5,
      activeTune: ecoTune,
      isFlashing: true,
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Flash complete, mountain mode
    _sessionController.add(RemappingSession(
      status: 'ECM FLASHED: MOUNTAIN TUNE ACTIVE',
      currentRegion: 'Colorado Rockies (Steep Climb)',
      upcomingGradePercent: 6.5,
      activeTune: mountainTune,
      isFlashing: false,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
