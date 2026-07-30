import 'package:flutter/material.dart';
import 'dart:async';
import '../models/fatigue_event_model.dart';
import '../services/computer_vision_monitor_service.dart';

class FatigueMonitorScreen extends StatefulWidget {
  const FatigueMonitorScreen({super.key});

  @override
  State<FatigueMonitorScreen> createState() => _FatigueMonitorScreenState();
}

class _FatigueMonitorScreenState extends State<FatigueMonitorScreen> {
  final ComputerVisionMonitorService _monitorService = ComputerVisionMonitorService();
  StreamSubscription<FatigueEvent?>? _subscription;
  
  bool _isMonitoring = false;
  bool _isAlertTriggered = false;
  String _alertMessage = '';
  
  void _toggleMonitoring() {
    setState(() {
      _isMonitoring = !_isMonitoring;
      _isAlertTriggered = false;
    });
    
    if (_isMonitoring) {
      _subscription = _monitorService.startMonitoringSession().listen((event) {
        if (event != null) {
          _triggerAlarm(event);
        }
      });
    } else {
      _subscription?.cancel();
    }
  }

  void _triggerAlarm(FatigueEvent event) {
    if (!mounted) return;
    
    _monitorService.reportEventToFleetManager(event);
    
    setState(() {
      _isAlertTriggered = true;
      if (event.eventType == 'MICROSLEEP') {
        _alertMessage = 'WAKE UP! MICROSLEEP DETECTED';
      } else if (event.eventType == 'PHONE_USAGE') {
        _alertMessage = 'PUT DOWN YOUR PHONE';
      } else {
        _alertMessage = 'EYES ON THE ROAD';
      }
    });
    
    // Auto-dismiss alert after 5 seconds
    Future.delayed(const Duration(seconds: 5), () {
      if (mounted && _isAlertTriggered) {
        setState(() {
          _isAlertTriggered = false;
        });
      }
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Safety Monitor'),
        backgroundColor: _isAlertTriggered ? Colors.red[900] : Colors.blueGrey[900],
      ),
      backgroundColor: _isAlertTriggered ? Colors.red : Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (_isAlertTriggered)
                      const Icon(Icons.warning_amber_rounded, size: 120, color: Colors.white)
                    else
                      Icon(Icons.camera_front, size: 120, color: _isMonitoring ? Colors.green : Colors.grey),
                    
                    const SizedBox(height: 24),
                    
                    Text(
                      _isAlertTriggered 
                        ? _alertMessage 
                        : (_isMonitoring ? 'Monitoring Active\nDriver Alert' : 'Camera Offline'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            
            Padding(
              padding: const EdgeInsets.all(24.0),
              child: SizedBox(
                width: double.infinity,
                height: 60,
                child: ElevatedButton(
                  onPressed: _toggleMonitoring,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _isMonitoring ? Colors.grey[800] : Colors.green[700],
                    foregroundColor: Colors.white,
                  ),
                  child: Text(
                    _isMonitoring ? 'STOP DASHCAM MONITORING' : 'START AI DASHCAM',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            )
          ],
        ),
      ),
    );
  }
}
