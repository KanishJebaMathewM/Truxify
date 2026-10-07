import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../core/api_client.dart';
import '../theme/app_theme.dart';
import 'package:flutter/material.dart';
import '../services/voice_recording_service.dart';

class VoiceAiScreen extends StatefulWidget {
  const VoiceAiScreen({Key? key}) : super(key: key);

  @override
  State<VoiceAiScreen> createState() => _VoiceAiScreenState();
}

class _VoiceAiScreenState extends State<VoiceAiScreen> {
  bool _isListening = false;
  String _transcript = 'Tap the microphone to speak with Truxify Voice AI...';
  String _aiResponse = '';

  void _toggleListening() async {
    if (!_isListening) {
      // 1. Request microphone permission
      final hasPermission = await VoiceRecordingService.requestPermission();
      if (!hasPermission) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Microphone permission is required for Voice AI.')),
        );
        return;
      }

      setState(() {
        _isListening = true;
        _transcript = 'Listening for freight booking or order inquiry...';
        _aiResponse = '';
      });

      // 2. Start streaming audio recording chunks
      await VoiceRecordingService.startRecording(
        onDataChunk: (chunk) {
          // Stream binary audio chunk to backend WebSocket / Voice AI service
        },
      );
    } else {
      // 3. Stop recording and process request
      await VoiceRecordingService.stopRecording();
      setState(() {
        _isListening = false;
        _transcript = '"Book a 10-ton heavy truck from Chennai to Bangalore."';
        _aiResponse = 'Processing voice query... Synthesizing via ElevenLabs.';
      });

      // Simulate backend AI response
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) {
          setState(() {
            _aiResponse = 'Confirmed! Heavy Truck booked. Estimated fare: ₹14,500. Waybill dispatched to your account.';
          });
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Truxify Voice AI Assistant'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Voice AI Pulse Visualizer Orb
            Container(
              width: 140,
              height: 140,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(
                  colors: _isListening
                      ? [Colors.red.shade400, Colors.orange.shade400]
                      : [Colors.blue.shade600, Colors.indigo.shade800],
                ),
                boxShadow: [
                  BoxShadow(
                    color: (_isListening ? Colors.red : Colors.blue).withOpacity(0.4),
                    blurRadius: 25,
                    spreadRadius: 5,
                  ),
                ],
              ),
              child: Icon(
                _isListening ? Icons.mic : Icons.mic_none,
                size: 64,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 40),

            // Transcript & AI Response Card
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: theme.cardColor,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: theme.dividerColor.withOpacity(0.1)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.03),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'USER QUERY TRANSCRIPT',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.grey),
                  ),
                  const SizedBox(height: 8),
                  Text(_transcript, style: const TextStyle(fontSize: 15, fontStyle: FontStyle.italic)),
                  if (_aiResponse.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    const Divider(height: 1),
                    const SizedBox(height: 16),
                    const Text(
                      'AI ASSISTANT (ELEVENLABS)',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.blue),
                    ),
                    const SizedBox(height: 8),
                    Text(_aiResponse, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500)),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 40),

            // Action Button
            ElevatedButton.icon(
              onPressed: _toggleListening,
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                backgroundColor: _isListening ? Colors.red.shade600 : theme.primaryColor,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
              ),
              icon: Icon(_isListening ? Icons.stop : Icons.mic),
              label: Text(_isListening ? 'Stop Recording & Submit' : 'Tap to Speak'),
            ),
          ],
        ),
      ),
    );
  }
}
class VoiceAiScreen extends StatefulWidget {
  const VoiceAiScreen({super.key, required this.orderId});

  final String orderId;

  @override
  State<VoiceAiScreen> createState() => _VoiceAiScreenState();
}

class _VoiceAiScreenState extends State<VoiceAiScreen> with SingleTickerProviderStateMixin {
  bool _isRecording = false;
  bool _isProcessing = false;
  bool _isPlaying = false;

  String? _transcript;
  String? _responseText;
  String? _audioUrl;
  String? _errorMessage;

  late AnimationController _waveController;
  final List<double> _waveAmplitudes = List.filled(30, 0.1);
  Timer? _amplitudeTimer;
  Timer? _playbackTimer;
  double _playbackProgress = 0.0;

  final AudioRecorder _recorder = AudioRecorder();
  String? _recordingPath;

  @override
  void initState() {
    super.initState();
    _waveController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    )..repeat();
  }

  @override
  void dispose() {
    _waveController.dispose();
    _amplitudeTimer?.cancel();
    _playbackTimer?.cancel();
    _recorder.dispose();
    super.dispose();
  }

  Future<void> _startRecording() async {
    final hasPermission = await _recorder.hasPermission();
    if (!hasPermission) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Microphone permission is required to use voice queries.';
      });
      return;
    }

    final dir = await getTemporaryDirectory();
    _recordingPath =
        '${dir.path}/voice_query_${DateTime.now().millisecondsSinceEpoch}.wav';

    await _recorder.start(
      const RecordConfig(
        encoder: AudioEncoder.wav,
        sampleRate: 16000,
        numChannels: 1,
      ),
      path: _recordingPath!,
    );

    setState(() {
      _isRecording = true;
      _transcript = null;
      _responseText = null;
      _audioUrl = null;
      _errorMessage = null;
      _isPlaying = false;
      _playbackProgress = 0.0;
    });

    _amplitudeTimer = Timer.periodic(const Duration(milliseconds: 100), (timer) async {
      final amp = await _recorder.getAmplitude();
      final normalized = ((amp.current + 45) / 45).clamp(0.0, 1.0);
      setState(() {
        _waveAmplitudes.removeAt(0);
        _waveAmplitudes.add(0.1 + normalized * 0.8);
      });
    });
  }

  Future<void> _stopRecording() async {
    _amplitudeTimer?.cancel();

    String? path;
    try {
      path = await _recorder.stop();
    } catch (e) {
      path = null;
    }

    setState(() {
      _isRecording = false;
      _isProcessing = true;
      for (int i = 0; i < _waveAmplitudes.length; i++) {
        _waveAmplitudes[i] = 0.1;
      }
    });

    if (path == null) {
      setState(() {
        _isProcessing = false;
        _errorMessage = 'Recording failed. Please try again.';
      });
      return;
    }

    final file = File(path);
    if (!await file.exists() || await file.length() == 0) {
      setState(() {
        _isProcessing = false;
        _errorMessage = 'No audio was captured. Please try again.';
      });
      return;
    }

    try {
      final session = Supabase.instance.client.auth.currentSession;
      final token = session?.accessToken ?? '';

      final request = http.MultipartRequest(
        'POST',
        Uri.parse('${ApiClient.defaultBaseUrl}/api/voice/query'),
      );

      if (token.isNotEmpty) {
        request.headers['Authorization'] = 'Bearer $token';
      }

      request.fields['bookingId'] = widget.orderId;
      request.files.add(
        await http.MultipartFile.fromPath(
          'file',
          file.path,
          filename: 'voice_query.wav',
        ),
      );

      final streamedResponse = await request.send();
      final response = await http.Response.fromStream(streamedResponse);

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        if (!mounted) return;
        setState(() {
          _transcript = data['transcript']?.toString();
          _responseText = data['response_text']?.toString();
          _audioUrl = data['audio_url']?.toString();
          _isProcessing = false;
        });

        if (_audioUrl != null) {
          _startPlayback();
        }
      } else {
        throw Exception('Server returned status: ${response.statusCode}');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isProcessing = false;
        _responseText = 'Failed to process voice query: $e';
      });
    } finally {
      try {
        if (await file.exists()) {
          await file.delete();
        }
      } catch (e) {
        debugPrint('VoiceAIScreen: failed to delete temp audio file: $e');
      }
    }
  }

  void _startPlayback() {
    setState(() {
      _isPlaying = true;
      _playbackProgress = 0.0;
    });

    _playbackTimer?.cancel();
    _playbackTimer = Timer.periodic(const Duration(milliseconds: 100), (timer) {
      setState(() {
        _playbackProgress += 0.04;
        if (_playbackProgress >= 1.0) {
          _playbackProgress = 1.0;
          _isPlaying = false;
          _playbackTimer?.cancel();
        }
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: Text(
          'Voice Assistant',
          style: GoogleFonts.dmSans(fontWeight: FontWeight.bold),
        ),
        elevation: 0,
        backgroundColor: Colors.transparent,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.outlineVariant.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.info_outline, color: TruxifyColors.accent),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Hold the mic button and speak. Ask "Where is my package?", "When will it reach?", or "Is my payment released?".',
                        style: GoogleFonts.dmSans(
                          fontSize: 12,
                          color: TruxifyColors.adaptiveSecondaryText(context),
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.redAccent.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    _errorMessage!,
                    style: GoogleFonts.dmSans(fontSize: 12, color: Colors.redAccent),
                  ),
                ),
              ],

              const Spacer(),

              SizedBox(
                height: 100,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(_waveAmplitudes.length, (index) {
                    return AnimatedContainer(
                      duration: const Duration(milliseconds: 100),
                      width: 4,
                      height: 10 + (_waveAmplitudes[index] * 80),
                      margin: const EdgeInsets.symmetric(horizontal: 2),
                      decoration: BoxDecoration(
                        color: _isRecording
                            ? TruxifyColors.accent
                            : TruxifyColors.accent.withValues(alpha: 0.3),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    );
                  }),
                ),
              ),

              const SizedBox(height: 40),

              Expanded(
                flex: 3,
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Theme.of(context).cardTheme.color,
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
                  ),
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (_isProcessing) ...[
                          const Center(child: CircularProgressIndicator()),
                          const SizedBox(height: 16),
                          Center(
                            child: Text(
                              'Transcribing and generating response...',
                              style: GoogleFonts.dmSans(
                                color: TruxifyColors.adaptiveSecondaryText(context),
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ] else ...[
                          if (_transcript != null) ...[
                            Text(
                              'You:',
                              style: GoogleFonts.dmSans(
                                fontWeight: FontWeight.bold,
                                color: TruxifyColors.accent,
                                fontSize: 12,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '"$_transcript"',
                              style: GoogleFonts.dmSans(
                                fontSize: 16,
                                fontStyle: FontStyle.italic,
                              ),
                            ),
                            const SizedBox(height: 20),
                          ],
                          if (_responseText != null) ...[
                            Text(
                              'Assistant:',
                              style: GoogleFonts.dmSans(
                                fontWeight: FontWeight.bold,
                                color: Colors.green,
                                fontSize: 12,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              _responseText!,
                              style: GoogleFonts.dmSans(
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 24),

                            if (_audioUrl != null) ...[
                              Row(
                                children: [
                                  IconButton(
                                    icon: Icon(
                                      _isPlaying ? Icons.pause_circle_filled : Icons.play_circle_filled,
                                      color: TruxifyColors.accent,
                                      size: 36,
                                    ),
                                    onPressed: () {
                                      if (_isPlaying) {
                                        _playbackTimer?.cancel();
                                        setState(() => _isPlaying = false);
                                      } else {
                                        _startPlayback();
                                      }
                                    },
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: LinearProgressIndicator(
                                      value: _playbackProgress,
                                      backgroundColor: Theme.of(context).colorScheme.outlineVariant,
                                      color: TruxifyColors.accent,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ],
                        ],
                      ],
                    ),
                  ),
                ),
              ),
              const Spacer(),

              GestureDetector(
                onLongPressStart: (_) => _startRecording(),
                onLongPressEnd: (_) => _stopRecording(),
                child: Column(
                  children: [
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      padding: EdgeInsets.all(_isRecording ? 24 : 18),
                      decoration: BoxDecoration(
                        color: _isRecording ? Colors.redAccent : TruxifyColors.accent,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: (_isRecording ? Colors.redAccent : TruxifyColors.accent)
                                .withValues(alpha: 0.3),
                            blurRadius: 16,
                            spreadRadius: _isRecording ? 8 : 4,
                          ),
                        ],
                      ),
                      child: const Icon(
                        Icons.mic,
                        color: Colors.white,
                        size: 36,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      _isRecording ? 'Release to Send' : 'Hold to Speak',
                      style: GoogleFonts.dmSans(
                        fontWeight: FontWeight.bold,
                        fontSize: 14,
                        color: _isRecording ? Colors.redAccent : Theme.of(context).colorScheme.onSurface,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
