class VoiceLoadOffer {
  final String loadId;
  final String spokenDescription;
  final String origin;
  final String destination;
  final double rate;

  VoiceLoadOffer({
    required this.loadId,
    required this.spokenDescription,
    required this.origin,
    required this.destination,
    required this.rate,
  });
}

class VoiceBookingSession {
  final String status;
  final bool isListening;
  final bool isSpeaking;
  final String transcript;
  final VoiceLoadOffer? currentOffer;
  final bool isBooked;

  VoiceBookingSession({
    required this.status,
    required this.isListening,
    required this.isSpeaking,
    required this.transcript,
    this.currentOffer,
    required this.isBooked,
  });
}
