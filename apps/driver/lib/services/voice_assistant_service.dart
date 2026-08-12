import 'dart:async';
import '../models/voice_command_model.dart';

class VoiceAssistantService {
  /// Simulates processing a voice command via NLP
  Future<VoiceCommand> processVoiceInput(String mockInput) async {
    await Future.delayed(const Duration(seconds: 2));

    if (mockInput.toLowerCase().contains('delay') || mockInput.toLowerCase().contains('traffic')) {
      return VoiceCommand(
        transcript: "Hey Truxify, report a 30 minute delay due to heavy traffic on I-95.",
        intent: 'report_delay',
        entities: {'duration': 30, 'reason': 'heavy traffic', 'location': 'I-95'},
        assistantResponse: "Got it. I've logged a 30-minute delay for traffic on I-95 and updated dispatch. Your new ETA is 14:30.",
      );
    } else if (mockInput.toLowerCase().contains('message')) {
      return VoiceCommand(
        transcript: "Hey Truxify, read my new dispatch messages.",
        intent: 'read_messages',
        entities: {},
        assistantResponse: "You have one new message from Dispatcher Sarah: 'Dock 4 is clear for you upon arrival.'",
      );
    } else {
      return VoiceCommand(
        transcript: "Hey Truxify, I've arrived at the shipper.",
        intent: 'update_status',
        entities: {'status': 'arrived'},
        assistantResponse: "Status updated to Arrived. I'll notify the receiving team.",
      );
    }
  }
}
