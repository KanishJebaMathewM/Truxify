import 'dart:async';

/// WebRTC Voice AI Client for Flutter Customer App
class VoiceAiClientService {
  bool _isRecording = false;
  final _transcriptionController = StreamController<String>.broadcast();

  Stream<String> get transcriptionStream => _transcriptionController.stream;

  Future<void> startVoiceSession() async {
    _isRecording = true;
    print('[Voice AI Client] Initializing WebRTC peer-to-peer audio stream...');
  }

  void processAudioInput(List<int> pcmData) {
    if (!_isRecording) return;
    // Simulated low-latency speech transcription push
    _transcriptionController.add("Where is my shipment?");
  }

  void stopVoiceSession() {
    _isRecording = false;
    print('[Voice AI Client] Closed WebRTC audio stream.');
  }
}
