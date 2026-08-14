import 'dart:async';
import '../models/ar_hud_model.dart';

class ArHudService {
  final _sessionController = StreamController<ArHudSession>.broadcast();

  Stream<ArHudSession> get hudStream => _sessionController.stream;

  void simulateHighwayNavigation() async {
    // 1. Cruising
    _sessionController.add(ArHudSession(
      status: 'Cruising: I-90 East',
      speedMph: 65.0,
      nextTurnDistanceMiles: 5.2,
      nextTurnInstruction: 'Keep straight on I-90 E',
      isHazardHighlightActive: false,
      lanes: [
        LaneDirective(laneIndex: 0, isTargetLane: false),
        LaneDirective(laneIndex: 1, isTargetLane: true), // Center lane
        LaneDirective(laneIndex: 2, isTargetLane: false),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Approaching Interchange
    _sessionController.add(ArHudSession(
      status: 'Complex Interchange Approaching',
      speedMph: 60.0,
      nextTurnDistanceMiles: 0.8,
      nextTurnInstruction: 'Use right lane to take Exit 15B',
      isHazardHighlightActive: true, // Flashing arrow to merge right
      lanes: [
        LaneDirective(laneIndex: 0, isTargetLane: false),
        LaneDirective(laneIndex: 1, isTargetLane: false), 
        LaneDirective(laneIndex: 2, isTargetLane: true, overlayText: 'EXIT 15B'),
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Merged, taking exit
    _sessionController.add(ArHudSession(
      status: 'Executing Exit 15B',
      speedMph: 45.0,
      nextTurnDistanceMiles: 0.1,
      nextTurnInstruction: 'Exit 15B to merge onto I-294 S',
      isHazardHighlightActive: false,
      lanes: [
        LaneDirective(laneIndex: 2, isTargetLane: true, overlayText: 'EXIT 15B'),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
