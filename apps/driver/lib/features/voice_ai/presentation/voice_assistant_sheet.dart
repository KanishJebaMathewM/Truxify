import 'dart:io';
import 'package:flutter/material.dart';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

class VoiceAssistantSheet extends StatefulWidget {
  final String backendUrl; // e.g., 'http://10.0.2.2:5000/api/v1/voice/assistant'

  const VoiceAssistantSheet({Key? key, required this.backendUrl}) : super(key: key);

  @override
  _VoiceAssistantSheetState createState() => _VoiceAssistantSheetState();
}

class _VoiceAssistantSheetState extends State<VoiceAssistantSheet> {
  final AudioRecorder _record = AudioRecorder();
  final AudioPlayer _audioPlayer = AudioPlayer();
  
  bool _isRecording = false;
  bool _isLoading = false;
  String _selectedLanguage = 'en'; // 'en', 'hi', 'ta'
  String? _recordedFilePath;

  @override
  void dispose() {
    _record.dispose();
    _audioPlayer.dispose();
    super.dispose();
  }

  Future<void> _startRecording() async {
    try {
      if (await _record.hasPermission()) {
        final dir = await getApplicationDocumentsDirectory();
        final path = '${dir.path}/query.m4a';
        
        await _record.start(
          const RecordConfig(encoder: AudioEncoder.aacLc),
          path: path,
        );
        setState(() {
          _isRecording = true;
          _recordedFilePath = path;
        });
      }
    } catch (e) {
      debugPrint("Recording Error: $e");
    }
  }

  Future<void> _stopRecordingAndSend() async {
    try {
      final path = await _record.stop();
      setState(() {
        _isRecording = false;
        _isLoading = true;
      });

      if (path != null) {
        await _sendAudioToBackend(path);
      }
    } catch (e) {
      debugPrint("Stop Recording Error: $e");
      setState(() => _isLoading = false);
    }
  }

  Future<void> _sendAudioToBackend(String audioPath) async {
    try {
      var request = http.MultipartRequest('POST', Uri.parse(widget.backendUrl));
      
      request.fields['language'] = _selectedLanguage;
      
      request.files.add(await http.MultipartFile.fromPath('audio', audioPath));

      // Optional: Add auth token here if needed
      // request.headers['Authorization'] = 'Bearer token';

      var streamedResponse = await request.send();

      if (streamedResponse.statusCode == 200) {
        // Save the received audio stream to a file
        final dir = await getApplicationDocumentsDirectory();
        final responsePath = '${dir.path}/response.mp3';
        final file = File(responsePath);
        
        final sink = file.openWrite();
        await streamedResponse.stream.listen((chunk) {
          sink.add(chunk);
        }).asFuture();
        await sink.close();

        // Play the audio
        await _audioPlayer.play(DeviceFileSource(responsePath));
      } else {
        debugPrint("Server Error: ${streamedResponse.statusCode}");
      }
    } catch (e) {
      debugPrint("Network Error: $e");
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24.0),
      height: 350,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(24.0),
          topRight: Radius.circular(24.0),
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text(
            'Truxify Voice Assistant',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          // Language Toggle
          ToggleButtons(
            isSelected: [
              _selectedLanguage == 'en',
              _selectedLanguage == 'hi',
              _selectedLanguage == 'ta',
            ],
            onPressed: (index) {
              setState(() {
                if (index == 0) _selectedLanguage = 'en';
                if (index == 1) _selectedLanguage = 'hi';
                if (index == 2) _selectedLanguage = 'ta';
              });
            },
            borderRadius: BorderRadius.circular(8),
            children: const [
              Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: Text('English')),
              Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: Text('Hindi')),
              Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: Text('Tamil')),
            ],
          ),
          const SizedBox(height: 32),
          // Microphone Button
          GestureDetector(
            onTapDown: (_) => _startRecording(),
            onTapUp: (_) => _stopRecordingAndSend(),
            onTapCancel: () => _stopRecordingAndSend(),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              height: _isRecording ? 100 : 80,
              width: _isRecording ? 100 : 80,
              decoration: BoxDecoration(
                color: _isRecording ? Colors.red : Colors.blue,
                shape: BoxShape.circle,
                boxShadow: _isRecording
                    ? [BoxShadow(color: Colors.red.withOpacity(0.5), blurRadius: 20, spreadRadius: 5)]
                    : [],
              ),
              child: _isLoading
                  ? const CircularProgressIndicator(color: Colors.white)
                  : const Icon(
                      Icons.mic,
                      color: Colors.white,
                      size: 40,
                    ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            _isLoading
                ? 'Processing...'
                : _isRecording
                    ? 'Release to Send'
                    : 'Hold to Speak',
            style: TextStyle(color: Colors.grey[700]),
          ),
        ],
      ),
    );
  }
}
