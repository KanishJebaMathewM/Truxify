class VoiceCommand {
  final String transcript;
  final String intent; // 'update_eta', 'report_delay', 'read_messages'
  final Map<String, dynamic> entities;
  final String assistantResponse;

  VoiceCommand({
    required this.transcript,
    required this.intent,
    required this.entities,
    required this.assistantResponse,
  });
}
