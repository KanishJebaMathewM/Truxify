import 'package:flutter/material.dart';
import '../models/voice_booking_model.dart';
import '../services/voice_booking_service.dart';

class VoiceBookingScreen extends StatefulWidget {
  const VoiceBookingScreen({super.key});

  @override
  State<VoiceBookingScreen> createState() => _VoiceBookingScreenState();
}

class _VoiceBookingScreenState extends State<VoiceBookingScreen> {
  final VoiceBookingService _service = VoiceBookingService();
  VoiceBookingSession? _session;

  @override
  void initState() {
    super.initState();
    _service.voiceStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeEngine();
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Voice-Activated Booking'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.status.contains('Inactive') == true ? () => _service.activateDriveMode() : null,
        backgroundColor: _session?.status.contains('Inactive') == true ? Colors.indigo : Colors.grey,
        icon: const Icon(Icons.drive_eta),
        label: const Text('Enable Drive Mode'),
      ),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;

    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (s.currentOffer != null)
                _buildLoadCard(s.currentOffer!, s.isBooked),
              const SizedBox(height: 24),
              if (s.isListening || s.transcript.isNotEmpty)
                _buildVoiceInteractionUI(s),
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(VoiceBookingSession s) {
    Color headerColor = Colors.blueGrey[800]!;
    if (s.isListening) headerColor = Colors.blue[700]!;
    if (s.isSpeaking) headerColor = Colors.purple[700]!;
    if (s.isBooked) headerColor = Colors.green[700]!;

    IconData icon = Icons.mic_off;
    if (s.isListening) icon = Icons.mic;
    if (s.isSpeaking) icon = Icons.volume_up;
    if (s.isBooked) icon = Icons.check_circle;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(32),
      color: headerColor,
      child: Column(
        children: [
          Icon(icon, color: Colors.white, size: 64),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildLoadCard(VoiceLoadOffer offer, bool isBooked) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isBooked ? Colors.green : Colors.transparent, width: 3),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              children: [
                Icon(isBooked ? Icons.check_circle : Icons.warning_amber, color: isBooked ? Colors.green : Colors.orange),
                const SizedBox(width: 12),
                Text(isBooked ? 'LOAD SECURED' : 'INCOMING OFFER', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: isBooked ? Colors.green : Colors.orange[800])),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('ROUTE', style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Text('${offer.origin} ➔ ${offer.destination}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('RATE', style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('\$${offer.rate.toStringAsFixed(2)}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.indigo)),
                  ],
                ),
              ],
            ),
            if (!isBooked) ...[
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(8)),
                child: Text('TTS: "${offer.spokenDescription}"', style: const TextStyle(fontStyle: FontStyle.italic)),
              )
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildVoiceInteractionUI(VoiceBookingSession s) {
    return Column(
      children: [
        if (s.isListening)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: LinearProgressIndicator(color: Colors.blue),
          ),
        if (s.isListening && !s.isBooked)
          Wrap(
            spacing: 12,
            children: [
              ElevatedButton.icon(
                onPressed: () => _service.simulateVoiceCommand('Hey Truxify, book it!'),
                icon: const Icon(Icons.record_voice_over),
                label: const Text('Say: "Book It"'),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white),
              ),
              ElevatedButton.icon(
                onPressed: () => _service.simulateVoiceCommand('Ignore'),
                icon: const Icon(Icons.close),
                label: const Text('Say: "Ignore"'),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.grey, foregroundColor: Colors.white),
              ),
            ],
          ),
        if (s.transcript.isNotEmpty) ...[
          const SizedBox(height: 16),
          Card(
            color: Colors.black,
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Row(
                children: [
                  const Icon(Icons.text_snippet, color: Colors.greenAccent),
                  const SizedBox(width: 12),
                  Expanded(child: Text('Driver NLP Transcript: "${s.transcript}"', style: const TextStyle(color: Colors.greenAccent, fontFamily: 'monospace'))),
                ],
              ),
            ),
          )
        ]
      ],
    );
  }
}
