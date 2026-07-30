class VoiceCommand {
  final String rawText;
  final String intent; // e.g., 'UPDATE_STATUS', 'CHECK_NEXT_STOP', 'SEND_MESSAGE'
  final Map<String, dynamic> entities;
  final double confidenceScore;
  final DateTime timestamp;

  VoiceCommand({
    required this.rawText,
    required this.intent,
    required this.entities,
    required this.confidenceScore,
    required this.timestamp,
  });
}
