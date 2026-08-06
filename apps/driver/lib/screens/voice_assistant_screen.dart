import 'package:flutter/material.dart';
import '../models/voice_command_model.dart';
import '../services/voice_assistant_service.dart';

class VoiceAssistantScreen extends StatefulWidget {
  const VoiceAssistantScreen({super.key});

  @override
  State<VoiceAssistantScreen> createState() => _VoiceAssistantScreenState();
}

class _VoiceAssistantScreenState extends State<VoiceAssistantScreen> with SingleTickerProviderStateMixin {
  final VoiceAssistantService _voiceService = VoiceAssistantService();
  bool _isListening = false;
  bool _isProcessing = false;
  VoiceCommand? _lastInteraction;
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  void _simulateVoiceCommand(String command) async {
    setState(() {
      _isListening = false;
      _isProcessing = true;
    });

    final result = await _voiceService.processVoiceInput(command);

    if (mounted) {
      setState(() {
        _isProcessing = false;
        _lastInteraction = result;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Truxify Voice Assistant'),
        backgroundColor: Colors.blue[900],
      ),
      backgroundColor: Colors.black,
      body: Column(
        children: [
          Expanded(
            child: Center(
              child: _buildVoiceInterface(),
            ),
          ),
          _buildSimulationControls(),
        ],
      ),
    );
  }

  Widget _buildVoiceInterface() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (_isListening)
          FadeTransition(
            opacity: _pulseController,
            child: Container(
              width: 150,
              height: 150,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.blue.withOpacity(0.3),
              ),
              child: const Icon(Icons.mic, size: 80, color: Colors.blueAccent),
            ),
          )
        else if (_isProcessing)
          const CircularProgressIndicator(color: Colors.blueAccent)
        else
          GestureDetector(
            onTap: () {
              setState(() {
                _isListening = true;
                _lastInteraction = null;
              });
            },
            child: Container(
              width: 150,
              height: 150,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white24, width: 2),
              ),
              child: const Icon(Icons.mic_none, size: 80, color: Colors.white54),
            ),
          ),
        const SizedBox(height: 32),
        if (_isListening)
          const Text('Listening... Say "Hey Truxify"', style: TextStyle(color: Colors.white70, fontSize: 18))
        else if (_isProcessing)
          const Text('Processing intent...', style: TextStyle(color: Colors.white70, fontSize: 18))
        else if (_lastInteraction == null)
          const Text('Tap mic to activate hands-free mode', style: TextStyle(color: Colors.white54, fontSize: 16)),
          
        if (_lastInteraction != null)
          Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.grey[900], borderRadius: BorderRadius.circular(12)),
                  child: Row(
                    children: [
                      const Icon(Icons.person, color: Colors.grey),
                      const SizedBox(width: 12),
                      Expanded(child: Text('"${_lastInteraction!.transcript}"', style: const TextStyle(color: Colors.white, fontSize: 16))),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.blue[900]!.withOpacity(0.3), borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.blue[900]!)),
                  child: Row(
                    children: [
                      const Icon(Icons.android, color: Colors.blueAccent),
                      const SizedBox(width: 12),
                      Expanded(child: Text(_lastInteraction!.assistantResponse, style: const TextStyle(color: Colors.white, fontSize: 16))),
                    ],
                  ),
                )
              ],
            ),
          )
      ],
    );
  }

  Widget _buildSimulationControls() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.only(topLeft: Radius.circular(24), topRight: Radius.circular(24)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Simulate Voice Commands', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ActionChip(
                label: const Text('Report Delay'),
                onPressed: () => _simulateVoiceCommand('delay'),
                backgroundColor: Colors.orange[100],
              ),
              ActionChip(
                label: const Text('Read Messages'),
                onPressed: () => _simulateVoiceCommand('message'),
                backgroundColor: Colors.blue[100],
              ),
              ActionChip(
                label: const Text('Update Status'),
                onPressed: () => _simulateVoiceCommand('arrived'),
                backgroundColor: Colors.green[100],
              ),
            ],
          )
        ],
      ),
    );
  }
}
