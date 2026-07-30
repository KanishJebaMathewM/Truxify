import 'dart:async';
import '../models/voice_command_model.dart';

class VoiceAiAssistantService {
  /// Simulates processing a voice audio stream into an actionable intent
  Future<VoiceCommand> processVoiceInput(String transcribedText) async {
    await Future.delayed(const Duration(seconds: 1)); // Simulate NLP processing
    
    String intent = 'UNKNOWN';
    Map<String, dynamic> entities = {};

    final lowerText = transcribedText.toLowerCase();
    
    if (lowerText.contains('arrived') || lowerText.contains('update status')) {
      intent = 'UPDATE_STATUS';
      entities['status'] = 'ARRIVED';
    } else if (lowerText.contains('next stop') || lowerText.contains('where to')) {
      intent = 'CHECK_NEXT_STOP';
    } else if (lowerText.contains('delay') || lowerText.contains('message dispatch')) {
      intent = 'SEND_MESSAGE';
      entities['message'] = transcribedText;
    }

    return VoiceCommand(
      rawText: transcribedText,
      intent: intent,
      entities: entities,
      confidenceScore: 0.92,
      timestamp: DateTime.now(),
    );
  }

  /// Executes the action based on the identified intent
  String executeIntent(VoiceCommand command) {
    switch (command.intent) {
      case 'UPDATE_STATUS':
        return 'Status updated to ${command.entities['status']}.';
      case 'CHECK_NEXT_STOP':
        return 'Your next stop is the Walmart Distribution Center in 45 miles.';
      case 'SEND_MESSAGE':
        return 'Message sent to dispatch regarding the delay.';
      default:
        return 'I didn\'t quite catch that. Try saying "Update status to arrived".';
    }
  }
}
