class DockingGeometry {
  final double distanceToDockFeet;
  final double trailerAngleDegrees;
  final double requiredSteeringWheelAngle;
  final double currentSteeringWheelAngle;
  final bool isAligned; // true if current equals required (within a margin)

  DockingGeometry({
    required this.distanceToDockFeet,
    required this.trailerAngleDegrees,
    required this.requiredSteeringWheelAngle,
    required this.currentSteeringWheelAngle,
    required this.isAligned,
  });
}

class DockingAssistSession {
  final String status; // "Approaching Dock 14", "Turn Wheel Hard Right", "Perfectly Aligned - Straighten Up"
  final String dockNumber;
  final bool isDocked;
  final DockingGeometry geometry;

  DockingAssistSession({
    required this.status,
    required this.dockNumber,
    required this.isDocked,
    required this.geometry,
  });
}
