import 'dart:async';
import '../models/cb_radio_translator_model.dart';

class CbRadioTranslatorService {
  final _messageController = StreamController<VoiceMessage>.broadcast();

  Stream<VoiceMessage> get incomingMessages => _messageController.stream;

  void simulateIncomingMessage() async {
    await Future.delayed(const Duration(seconds: 2));
    _messageController.add(
      VoiceMessage(
        messageId: 'MSG-001',
        senderName: 'Dock Manager (Door 4)',
        originalLanguage: 'en-US',
        translatedLanguage: 'es-MX',
        originalTranscription: "Hey driver, back into door four but watch out for the forklift on your blind side.",
        translatedText: "Oye conductor, retrocede hasta la puerta cuatro pero ten cuidado con el montacargas en tu punto ciego.",
        timestamp: DateTime.now(),
        isIncoming: true,
      ),
    );
  }

  Future<VoiceMessage> transmitMessage(String audioPath, String targetLanguage) async {
    // Simulate speech-to-text and translation
    await Future.delayed(const Duration(seconds: 1));
    return VoiceMessage(
      messageId: 'MSG-002',
      senderName: 'Me',
      originalLanguage: 'es-MX',
      translatedLanguage: targetLanguage,
      originalTranscription: "Copiado, retrocediendo a la puerta cuatro ahora.",
      translatedText: "Copy that, backing into door four now.",
      timestamp: DateTime.now(),
      isIncoming: false,
    );
  }

  void dispose() {
    _messageController.close();
  }
}
