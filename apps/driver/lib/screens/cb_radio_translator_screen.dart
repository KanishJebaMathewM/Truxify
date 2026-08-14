import 'package:flutter/material.dart';
import '../models/cb_radio_translator_model.dart';
import '../services/cb_radio_translator_service.dart';

class CbRadioTranslatorScreen extends StatefulWidget {
  const CbRadioTranslatorScreen({super.key});

  @override
  State<CbRadioTranslatorScreen> createState() => _CbRadioTranslatorScreenState();
}

class _CbRadioTranslatorScreenState extends State<CbRadioTranslatorScreen> {
  final CbRadioTranslatorService _service = CbRadioTranslatorService();
  final List<VoiceMessage> _messages = [];
  bool _isRecording = false;

  @override
  void initState() {
    super.initState();
    _service.incomingMessages.listen((msg) {
      if (mounted) {
        setState(() {
          _messages.add(msg);
        });
      }
    });

    // Simulate an incoming transmission after screen loads
    _service.simulateIncomingMessage();
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  void _onPushToTalkDown() {
    setState(() {
      _isRecording = true;
    });
  }

  void _onPushToTalkUp() async {
    setState(() {
      _isRecording = false;
    });

    final msg = await _service.transmitMessage('temp/audio.wav', 'en-US');
    if (mounted) {
      setState(() {
        _messages.add(msg);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI CB Radio'),
        backgroundColor: Colors.amber[900],
      ),
      backgroundColor: Colors.grey[900],
      body: Column(
        children: [
          _buildChannelHeader(),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                return _buildMessageBubble(_messages[index]);
              },
            ),
          ),
          _buildPushToTalkInterface(),
        ],
      ),
    );
  }

  Widget _buildChannelHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      color: Colors.black,
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Icon(Icons.radio, color: Colors.amber),
              SizedBox(width: 12),
              Text('Channel: DOCK-19', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
            ],
          ),
          Row(
            children: [
              Icon(Icons.translate, color: Colors.grey),
              SizedBox(width: 8),
              Text('EN ⇄ ES', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMessageBubble(VoiceMessage msg) {
    final isMe = !msg.isIncoming;
    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 24),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
        child: Column(
          crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            Text(msg.senderName, style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: isMe ? Colors.amber[900] : Colors.grey[800],
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.volume_up, size: 16, color: isMe ? Colors.white : Colors.amber),
                      const SizedBox(width: 8),
                      Text('Playing translation in ${msg.translatedLanguage}...', style: TextStyle(color: isMe ? Colors.white70 : Colors.amber, fontSize: 12, fontStyle: FontStyle.italic)),
                    ],
                  ),
                  const Divider(color: Colors.white24, height: 16),
                  Text(msg.translatedText, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text('Original (${msg.originalLanguage}): ${msg.originalTranscription}', style: const TextStyle(color: Colors.white54, fontSize: 12)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPushToTalkInterface() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.only(top: 24, bottom: 48),
      color: Colors.black,
      child: Column(
        children: [
          Text(
            _isRecording ? 'TRANSMITTING...' : 'HOLD TO TALK',
            style: TextStyle(color: _isRecording ? Colors.red : Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5),
          ),
          const SizedBox(height: 24),
          GestureDetector(
            onTapDown: (_) => _onPushToTalkDown(),
            onTapUp: (_) => _onPushToTalkUp(),
            onTapCancel: _onPushToTalkUp,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 100),
              width: _isRecording ? 100 : 80,
              height: _isRecording ? 100 : 80,
              decoration: BoxDecoration(
                color: _isRecording ? Colors.red : Colors.amber[900],
                shape: BoxShape.circle,
                boxShadow: _isRecording ? [const BoxShadow(color: Colors.redAccent, blurRadius: 20, spreadRadius: 5)] : [],
              ),
              child: const Icon(Icons.mic, color: Colors.white, size: 40),
            ),
          ),
        ],
      ),
    );
  }
}
