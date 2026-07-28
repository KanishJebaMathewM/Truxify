class FatigueEvent {
  final String eventId;
  final String eventType; // 'MICROSLEEP', 'PHONE_USAGE', 'DISTRACTION'
  final DateTime timestamp;
  final double confidenceScore;
  final double durationSeconds;
  
  FatigueEvent({
    required this.eventId,
    required this.eventType,
    required this.timestamp,
    required this.confidenceScore,
    required this.durationSeconds,
  });
}
