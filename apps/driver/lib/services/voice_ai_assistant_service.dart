import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:audioplayers/audioplayers.dart';
import '../models/voice_command_model.dart';

class VoiceAiAssistantService {
  RTCPeerConnection? _peerConnection;
  final AudioPlayer _audioPlayer = AudioPlayer();
  int _reconnectAttempts = 0;
  static const int _maxReconnectAttempts = 3;

  /// Initializes the WebRTC connection and monitors iceConnectionState for auto-reconnect
  Future<void> initializeWebRTC() async {
    try {
      _peerConnection = await createPeerConnection({});
      
      _peerConnection?.onIceConnectionState = (RTCIceConnectionState state) {
        if (state == RTCIceConnectionState.RTCIceConnectionStateDisconnected ||
            state == RTCIceConnectionState.RTCIceConnectionStateFailed) {
          _handleDisconnect();
        } else if (state == RTCIceConnectionState.RTCIceConnectionStateConnected) {
          _reconnectAttempts = 0;
          debugPrint('WebRTC Connection established.');
        }
      };
    } catch (e) {
      debugPrint('Failed to initialize WebRTC: $e');
    }
  }

  Future<void> _handleDisconnect() async {
    if (_reconnectAttempts >= _maxReconnectAttempts) {
      debugPrint('Max reconnection attempts reached. Voice AI disconnected.');
      return;
    }

    _reconnectAttempts++;
    debugPrint('Connection lost. Reconnecting to Assistant... Attempt $_reconnectAttempts');
    
    try {
      // Play local audio prompt
      await _audioPlayer.play(AssetSource('audio/reconnecting.mp3'));
    } catch (e) {
      debugPrint('Could not play audio prompt: $e');
    }

    // Wait before reconnecting
    await Future.delayed(const Duration(seconds: 2));
    
    // Attempt to restore the connection
    try {
      await _peerConnection?.close();
      await initializeWebRTC();
      // In a real application, SDP negotiation would follow here
    } catch (e) {
      debugPrint('Reconnection attempt failed: $e');
      _handleDisconnect();
    }
  }

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
