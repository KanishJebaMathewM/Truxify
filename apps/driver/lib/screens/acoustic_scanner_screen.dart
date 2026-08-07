import 'package:flutter/material.dart';
import 'dart:async';
import '../models/acoustic_diagnostic_model.dart';
import '../services/acoustic_ml_service.dart';

class AcousticScannerScreen extends StatefulWidget {
  const AcousticScannerScreen({super.key});

  @override
  State<AcousticScannerScreen> createState() => _AcousticScannerScreenState();
}

class _AcousticScannerScreenState extends State<AcousticScannerScreen> with SingleTickerProviderStateMixin {
  final AcousticMlService _mlService = AcousticMlService();
  AcousticDiagnosticResult? _result;
  bool _isRecording = false;
  bool _isAnalyzing = false;
  int _recordingTime = 0;
  Timer? _timer;
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(vsync: this, duration: const Duration(seconds: 1));
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pulseController.dispose();
    super.dispose();
  }

  void _startRecording() {
    setState(() {
      _isRecording = true;
      _recordingTime = 0;
      _result = null;
    });
    
    _pulseController.repeat(reverse: true);

    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      setState(() {
        _recordingTime++;
      });

      if (_recordingTime >= 5) { // Simulate 5 seconds recording
        _stopRecordingAndAnalyze();
      }
    });
  }

  void _stopRecordingAndAnalyze() async {
    _timer?.cancel();
    _pulseController.stop();

    setState(() {
      _isRecording = false;
      _isAnalyzing = true;
    });

    final result = await _mlService.analyzeEngineAudio();

    if (mounted) {
      setState(() {
        _result = result;
        _isAnalyzing = false;
      });
    }
  }

  void _resetScanner() {
    setState(() {
      _result = null;
      _recordingTime = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Acoustic Engine Diagnostics'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[100],
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isRecording || _isAnalyzing) {
      return _buildActiveStateView();
    } else if (_result != null) {
      return _buildResultsView();
    } else {
      return _buildReadyView();
    }
  }

  Widget _buildReadyView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.graphic_eq, size: 100, color: Colors.indigo[300]),
            const SizedBox(height: 24),
            const Text(
              'Listen to Engine',
              style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            const Text(
              'Safely pop the hood or place phone near the cabin floor. We will record 5 seconds of audio to detect mechanical anomalies using AI.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey, fontSize: 16),
            ),
            const SizedBox(height: 40),
            GestureDetector(
              onTap: _startRecording,
              child: Container(
                width: 120,
                height: 120,
                decoration: BoxDecoration(
                  color: Colors.red[600],
                  shape: BoxShape.circle,
                  boxShadow: [BoxShadow(color: Colors.red.withOpacity(0.4), blurRadius: 20, spreadRadius: 5)],
                ),
                child: const Icon(Icons.mic, color: Colors.white, size: 60),
              ),
            ),
            const SizedBox(height: 24),
            const Text('TAP TO RECORD', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.grey))
          ],
        ),
      ),
    );
  }

  Widget _buildActiveStateView() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (_isRecording)
            AnimatedBuilder(
              animation: _pulseController,
              builder: (context, child) {
                return Container(
                  width: 150 + (_pulseController.value * 20),
                  height: 150 + (_pulseController.value * 20),
                  decoration: BoxDecoration(color: Colors.red.withOpacity(0.2), shape: BoxShape.circle),
                  child: Center(
                    child: Container(
                      width: 100,
                      height: 100,
                      decoration: BoxDecoration(color: Colors.red[600], shape: BoxShape.circle),
                      child: const Icon(Icons.mic, color: Colors.white, size: 50),
                    ),
                  ),
                );
              },
            ),
          
          if (_isAnalyzing)
            const SizedBox(
              width: 100,
              height: 100,
              child: CircularProgressIndicator(color: Colors.indigo, strokeWidth: 8),
            ),

          const SizedBox(height: 40),
          Text(
            _isRecording ? 'Listening... 0:0$_recordingTime' : 'Running Spectrogram Analysis...',
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }

  Widget _buildResultsView() {
    final r = _result!;
    final bool isCritical = r.severityLevel == 'Critical';

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(color: isCritical ? Colors.red[900] : Colors.green[800], borderRadius: BorderRadius.circular(12)),
            child: Column(
              children: [
                Icon(isCritical ? Icons.warning_amber_rounded : Icons.check_circle_outline, color: Colors.white, size: 60),
                const SizedBox(height: 16),
                Text(
                  r.detectedAnomaly,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Text('Confidence: ${r.confidenceScore}%', style: const TextStyle(color: Colors.white70)),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(20.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.build, color: Colors.indigo[800]),
                      const SizedBox(width: 8),
                      const Text('Recommended Action', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(r.recommendedAction, style: TextStyle(color: Colors.grey[800], fontSize: 16)),
                  const Divider(height: 32),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Drive Status:', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.grey)),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(color: r.isSafeToDrive ? Colors.green[100] : Colors.red[100], borderRadius: BorderRadius.circular(20)),
                        child: Text(
                          r.isSafeToDrive ? 'SAFE TO DRIVE' : 'DO NOT DRIVE',
                          style: TextStyle(fontWeight: FontWeight.bold, color: r.isSafeToDrive ? Colors.green[800] : Colors.red[800]),
                        ),
                      )
                    ],
                  )
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          if (!r.isSafeToDrive)
             SizedBox(
               width: double.infinity,
               height: 56,
               child: ElevatedButton.icon(
                 onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Contacting Roadside Assistance...')));
                 },
                 icon: const Icon(Icons.support_agent),
                 label: const Text('CALL ROADSIDE ASSISTANCE'),
                 style: ElevatedButton.styleFrom(backgroundColor: Colors.red[900], foregroundColor: Colors.white),
               ),
             ),
          const SizedBox(height: 16),
          TextButton(onPressed: _resetScanner, child: const Text('Take Another Reading', style: TextStyle(color: Colors.grey))),
        ],
      ),
    );
  }
}
