class VoiceMessage {
  final String messageId;
  final String senderName;
  final String originalLanguage;
  final String translatedLanguage;
  final String originalTranscription;
  final String translatedText;
  final DateTime timestamp;
  final bool isIncoming;

  VoiceMessage({
    required this.messageId,
    required this.senderName,
    required this.originalLanguage,
    required this.translatedLanguage,
    required this.originalTranscription,
    required this.translatedText,
    required this.timestamp,
    required this.isIncoming,
  });
}
