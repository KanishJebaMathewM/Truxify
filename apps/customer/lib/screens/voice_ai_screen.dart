import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../core/api_client.dart';
import '../theme/app_theme.dart';

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
  
  late AnimationController _waveController;
  final List<double> _waveAmplitudes = List.filled(30, 0.1);
  Timer? _recordingTimer;
  Timer? _playbackTimer;
  double _playbackProgress = 0.0;
  
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
    _recordingTimer?.cancel();
    _playbackTimer?.cancel();
    super.dispose();
  }

  void _startRecording() {
    setState(() {
      _isRecording = true;
      _transcript = null;
      _responseText = null;
      _audioUrl = null;
      _isPlaying = false;
      _playbackProgress = 0.0;
    });

    _recordingTimer = Timer.periodic(const Duration(milliseconds: 100), (timer) {
      final random = math.Random();
      setState(() {
        for (int i = 0; i < _waveAmplitudes.length; i++) {
          _waveAmplitudes[i] = 0.1 + random.nextDouble() * 0.8;
        }
      });
    });
  }

  Future<void> _stopRecording() async {
    _recordingTimer?.cancel();
    setState(() {
      _isRecording = false;
      _isProcessing = true;
      for (int i = 0; i < _waveAmplitudes.length; i++) {
        _waveAmplitudes[i] = 0.1;
      }
    });

    try {
      final session = Supabase.instance.client.auth.currentSession;
      final token = session?.accessToken ?? '';
      
      final dummyWav = List<int>.filled(1000, 0);
      
      final request = http.MultipartRequest(
        'POST',
        Uri.parse('${ApiClient.defaultBaseUrl}/api/voice/query'),
      );
      
      if (token.isNotEmpty) {
        request.headers['Authorization'] = 'Bearer $token';
      }
      
      request.fields['bookingId'] = widget.orderId;
      request.files.add(
        http.MultipartFile.fromBytes(
          'file',
          dummyWav,
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
