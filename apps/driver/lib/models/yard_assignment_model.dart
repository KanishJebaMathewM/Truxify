class YardAssignment {
  final String facilityName;
  final String assignmentType; // 'Live Load', 'Drop Trailer', 'Pick Empty'
  final String targetId; // e.g., 'Dock Door 42', 'Trailer XZ-104'
  final double latitude;
  final double longitude;
  final String status; // 'Pending Entry', 'Navigating Yard', 'At Destination'
  final double distanceToTargetMeters;
  final String instructions;

  YardAssignment({
    required this.facilityName,
    required this.assignmentType,
    required this.targetId,
    required this.latitude,
    required this.longitude,
    required this.status,
    required this.distanceToTargetMeters,
    required this.instructions,
  });
}
