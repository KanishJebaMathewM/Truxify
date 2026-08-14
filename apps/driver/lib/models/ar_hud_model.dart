class LaneDirective {
  final int laneIndex; // 0 is far left, 1 is middle, 2 is right
  final bool isTargetLane; // True if this is the lane the driver should be in
  final String? overlayText; // "EXIT 15B"

  LaneDirective({
    required this.laneIndex,
    required this.isTargetLane,
    this.overlayText,
  });
}

class ArHudSession {
  final String status; // "Cruising", "Complex Interchange Approaching"
  final double speedMph;
  final double nextTurnDistanceMiles;
  final String nextTurnInstruction;
  final bool isHazardHighlightActive;
  final List<LaneDirective> lanes;

  ArHudSession({
    required this.status,
    required this.speedMph,
    required this.nextTurnDistanceMiles,
    required this.nextTurnInstruction,
    required this.isHazardHighlightActive,
    required this.lanes,
  });
}
