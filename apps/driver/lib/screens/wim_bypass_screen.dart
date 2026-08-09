import 'package:flutter/material.dart';
import '../models/weigh_in_motion_model.dart';
import '../services/weigh_station_bypass_service.dart';

class WimBypassScreen extends StatefulWidget {
  const WimBypassScreen({super.key});

  @override
  State<WimBypassScreen> createState() => _WimBypassScreenState();
}

class _WimBypassScreenState extends State<WimBypassScreen> {
  final WeighStationBypassService _bypassService = WeighStationBypassService();
  WeighInMotionEvent? _currentEvent;
  bool _isSimulating = false;

  void _triggerApproach() {
    setState(() {
      _isSimulating = true;
    });

    // Simulate an approach with a compliant weight
    _bypassService.simulateApproach('Ohio', 78500.0).listen((event) {
      if (mounted) {
        setState(() {
          _currentEvent = event;
          if (event.bypassStatus != 'APPROACHING') {
            _isSimulating = false;
          }
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    Color bgColor = Colors.blueGrey[900]!;
    if (_currentEvent != null) {
      if (_currentEvent!.bypassStatus == 'CLEARED_TO_BYPASS') {
        bgColor = Colors.green[800]!;
      } else if (_currentEvent!.bypassStatus == 'MUST_PULL_IN') {
        bgColor = Colors.red[800]!;
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Weigh Station Bypass'),
        backgroundColor: Colors.black87,
      ),
      backgroundColor: bgColor,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (_currentEvent == null) ...[
                const Icon(Icons.sensor_window, size: 100, color: Colors.white54),
                const SizedBox(height: 24),
                const Text('No Weigh Station Approaching', style: TextStyle(color: Colors.white, fontSize: 24)),
                const SizedBox(height: 48),
                ElevatedButton(
                  onPressed: _triggerApproach,
                  style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16)),
                  child: const Text('SIMULATE APPROACH (2 MILES OUT)'),
                )
              ] else ...[
                _buildStatusDisplay(),
                const SizedBox(height: 48),
                if (!_isSimulating)
                  TextButton(
                    onPressed: () {
                      setState(() {
                        _currentEvent = null;
                      });
                    },
                    child: const Text('DISMISS', style: TextStyle(color: Colors.white, fontSize: 18)),
                  )
              ]
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatusDisplay() {
    IconData icon;
    String title;
    String subtitle;

    switch (_currentEvent!.bypassStatus) {
      case 'APPROACHING':
        icon = Icons.wifi_tethering;
        title = 'TRANSMITTING CREDENTIALS';
        subtitle = 'Approaching ${_currentEvent!.state} Weigh Station';
        break;
      case 'CLEARED_TO_BYPASS':
        icon = Icons.check_circle_outline;
        title = 'BYPASS GRANTED';
        subtitle = 'You are cleared to bypass the scales.';
        break;
      case 'MUST_PULL_IN':
        icon = Icons.warning_amber;
        title = 'PULL IN TO WEIGH STATION';
        subtitle = 'Random inspection or weight discrepancy.';
        break;
      default:
        icon = Icons.error;
        title = 'ERROR';
        subtitle = '';
    }

    return Column(
      children: [
        Icon(icon, size: 120, color: Colors.white),
        const SizedBox(height: 24),
        Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.white)),
        const SizedBox(height: 12),
        Text(subtitle, textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, color: Colors.white70)),
        const SizedBox(height: 32),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(12)),
          child: Column(
            children: [
              Text('Station: ${_currentEvent!.stationId}', style: const TextStyle(color: Colors.white, fontSize: 16)),
              const SizedBox(height: 8),
              Text('Est. Gross Weight: ${_currentEvent!.currentGrossWeightLbs} lbs', style: const TextStyle(color: Colors.white, fontSize: 16)),
            ],
          ),
        )
      ],
    );
  }
}
