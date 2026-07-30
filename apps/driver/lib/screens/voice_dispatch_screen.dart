import 'package:flutter/material.dart';
import '../services/voice_ai_assistant_service.dart';

class VoiceDispatchScreen extends StatefulWidget {
  const VoiceDispatchScreen({super.key});

  @override
  State<VoiceDispatchScreen> createState() => _VoiceDispatchScreenState();
}

class _VoiceDispatchScreenState extends State<VoiceDispatchScreen> {
  final VoiceAiAssistantService _voiceService = VoiceAiAssistantService();
  bool _isListening = false;
  String _displayText = 'Say "Hey Truxify"...';
  String _systemResponse = '';

  void _toggleListening() async {
    setState(() {
      _isListening = !_isListening;
      _systemResponse = '';
      if (_isListening) {
        _displayText = 'Listening... Try saying "Update my status to arrived"';
      } else {
        _displayText = 'Say "Hey Truxify"...';
      }
    });

    if (_isListening) {
      // Simulate user speaking after 2 seconds
      await Future.delayed(const Duration(seconds: 2));
      if (!mounted || !_isListening) return;

      setState(() {
        _displayText = 'Processing: "Update my status to arrived at the dock"';
      });

      final command = await _voiceService.processVoiceInput('Update my status to arrived at the dock');
      final response = _voiceService.executeIntent(command);

      if (mounted) {
        setState(() {
          _isListening = false;
          _displayText = 'Command Executed';
          _systemResponse = response;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Voice AI Dispatch'),
        backgroundColor: Colors.blueAccent[700],
      ),
      backgroundColor: Colors.blueGrey[900],
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              GestureDetector(
                onTap: _toggleListening,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  height: _isListening ? 180 : 120,
                  width: _isListening ? 180 : 120,
                  decoration: BoxDecoration(
                    color: _isListening ? Colors.redAccent : Colors.blueAccent,
                    shape: BoxShape.circle,
                    boxShadow: _isListening 
                      ? [BoxShadow(color: Colors.redAccent.withOpacity(0.5), blurRadius: 30, spreadRadius: 10)]
                      : [],
                  ),
                  child: Icon(
                    _isListening ? Icons.mic : Icons.mic_none,
                    size: 64,
                    color: Colors.white,
                  ),
                ),
              ),
              const SizedBox(height: 48),
              Text(
                _displayText,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 22, color: Colors.white70, fontStyle: FontStyle.italic),
              ),
              const SizedBox(height: 24),
              if (_systemResponse.isNotEmpty)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.green[800],
                    borderRadius: BorderRadius.circular(12)
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.volume_up, color: Colors.white),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          _systemResponse,
                          style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                        ),
                      )
                    ],
                  ),
                )
            ],
          ),
        ),
      ),
    );
  }
}
