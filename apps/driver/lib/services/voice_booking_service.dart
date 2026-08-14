import 'dart:async';
import '../models/voice_booking_model.dart';

class VoiceBookingService {
  final _sessionController = StreamController<VoiceBookingSession>.broadcast();
  
  Stream<VoiceBookingSession> get voiceStream => _sessionController.stream;

  VoiceLoadOffer? _activeOffer;

  void initializeEngine() {
    _emitState('Drive Mode Inactive', false, false, '', false);
  }

  void activateDriveMode() async {
    _emitState('Drive Mode Active: Waiting for loads...', true, false, '', false);

    await Future.delayed(const Duration(seconds: 2));

    _activeOffer = VoiceLoadOffer(
      loadId: 'L-90210',
      origin: 'Dallas, TX',
      destination: 'Chicago, IL',
      rate: 3450.00,
      spokenDescription: 'New flatbed load available. Dallas, Texas to Chicago, Illinois paying \$3,450. Say "Book It" to accept.',
    );

    _emitState('Reading Load Aloud via TTS...', false, true, '...', false);
    
    await Future.delayed(const Duration(seconds: 3));

    _emitState('Awaiting Driver Voice Command...', true, false, '...', false);
  }

  void simulateVoiceCommand(String command) async {
    _emitState('Processing NLP Intent...', false, false, command, false);

    await Future.delayed(const Duration(seconds: 1));

    if (command.toLowerCase().contains('book it') || command.toLowerCase().contains('accept')) {
      _emitState('Load Successfully Booked via Voice!', false, false, command, true);
    } else {
      _emitState('Command ignored. Waiting for next load...', true, false, command, false);
      _activeOffer = null; // Clear offer
    }
  }

  void _emitState(String status, bool listening, bool speaking, String transcript, bool booked) {
    _sessionController.add(VoiceBookingSession(
      status: status,
      isListening: listening,
      isSpeaking: speaking,
      transcript: transcript,
      currentOffer: _activeOffer,
      isBooked: booked,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
