import 'package:flutter/material.dart';
import '../models/driver_fatigue_model.dart';
import '../services/fatigue_detection_service.dart';

class FatigueMonitorScreen extends StatefulWidget {
  const FatigueMonitorScreen({super.key});

  @override
  State<FatigueMonitorScreen> createState() => _FatigueMonitorScreenState();
}

class _FatigueMonitorScreenState extends State<FatigueMonitorScreen> {
  final FatigueDetectionService _visionService = FatigueDetectionService();
  FatigueMetrics? _currentMetrics;
  bool _isMonitoring = false;

  void _toggleMonitoring() {
    setState(() {
      _isMonitoring = !_isMonitoring;
      if (_isMonitoring) {
        _visionService.startVisionProcessing().listen((metrics) {
          if (mounted) {
            setState(() {
              _currentMetrics = metrics;
            });
            if (metrics.isMicroSleepDetected) {
              _triggerAlarm();
            }
          }
        });
      } else {
        _currentMetrics = null;
      }
    });
  }

  void _triggerAlarm() {
    showDialog(
      context: context,
      barrierColor: Colors.red.withOpacity(0.8),
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.white,
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: Colors.red, size: 40),
            SizedBox(width: 16),
            Text('CRITICAL FATIGUE', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold)),
          ],
        ),
        content: const Text(
          'Micro-sleep detected! Dispatch has been notified. Please pull over immediately to rest.',
          style: TextStyle(fontSize: 18),
        ),
        actions: [
          ElevatedButton(
            onPressed: () => Navigator.pop(context),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red[900], foregroundColor: Colors.white),
            child: const Text('I AM AWAKE - SNOOZE ALARM'),
          )
        ],
      )
    );
  }

  @override
  Widget build(BuildContext context) {
    final isCritical = _currentMetrics?.fatigueLevel == 'Critical';
    final isDrowsy = _currentMetrics?.fatigueLevel == 'Drowsy';

    Color statusColor = Colors.grey;
    if (_isMonitoring) {
      if (isCritical) statusColor = Colors.red;
      else if (isDrowsy) statusColor = Colors.orange;
      else statusColor = Colors.green;
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Driver AI Monitor'),
        backgroundColor: Colors.blueGrey[900],
      ),
      body: Column(
        children: [
          Container(
            height: 250,
            width: double.infinity,
            color: Colors.black,
            child: Stack(
              alignment: Alignment.center,
              children: [
                if (_isMonitoring)
                  const Icon(Icons.face, size: 150, color: Colors.white24)
                else
                  const Icon(Icons.videocam_off, size: 80, color: Colors.white54),
                if (_isMonitoring)
                  Positioned(
                    bottom: 16,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(20)),
                      child: const Row(
                        children: [
                          Icon(Icons.fiber_manual_record, color: Colors.red, size: 12),
                          SizedBox(width: 8),
                          Text('EDGE AI ACTIVE - SECURE', style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  )
              ],
            ),
          ),
          Expanded(
            child: Container(
              color: Colors.grey[100],
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  _buildStatusHeader(statusColor),
                  const SizedBox(height: 32),
                  if (_currentMetrics != null) ...[
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _buildMetricDial('Eye Closure', '${(_currentMetrics!.eyeClosurePercentage * 100).toInt()}%'),
                        _buildMetricDial('Blink Rate', '${_currentMetrics!.blinkRatePerMinute.toInt()}/m'),
                        _buildMetricDial('Head Nods', '${_currentMetrics!.headNodsDetected}'),
                      ],
                    ),
                  ] else
                    const Expanded(
                      child: Center(child: Text('Start Edge AI monitoring to begin analysis.', style: TextStyle(color: Colors.grey, fontSize: 16))),
                    ),
                  const Spacer(),
                  SizedBox(
                    width: double.infinity,
                    height: 60,
                    child: ElevatedButton.icon(
                      onPressed: _toggleMonitoring,
                      icon: Icon(_isMonitoring ? Icons.stop : Icons.play_arrow),
                      label: Text(_isMonitoring ? 'STOP MONITORING' : 'ACTIVATE CAMERA AI'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _isMonitoring ? Colors.red[900] : Colors.blueGrey[900],
                        foregroundColor: Colors.white,
                      ),
                    ),
                  )
                ],
              ),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildStatusHeader(Color color) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: color.withOpacity(0.1), borderRadius: BorderRadius.circular(16), border: BorderSide(color: color, width: 2)),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.health_and_safety, color: color, size: 32),
          const SizedBox(width: 16),
          Text(
            _isMonitoring ? 'STATUS: ${_currentMetrics?.fatigueLevel.toUpperCase() ?? 'ANALYZING'}' : 'SYSTEM STANDBY',
            style: TextStyle(color: color, fontSize: 24, fontWeight: FontWeight.bold),
          )
        ],
      ),
    );
  }

  Widget _buildMetricDial(String label, String value) {
    return Column(
      children: [
        Container(
          width: 80,
          height: 80,
          decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white, border: BorderSide(color: Colors.blueGrey[200]!, width: 4)),
          alignment: Alignment.center,
          child: Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.blueGrey)),
        ),
        const SizedBox(height: 12),
        Text(label, style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
      ],
    );
  }
}
