import 'package:flutter/material.dart';
import '../models/biometric_fatigue_model.dart';
import '../services/biometric_fatigue_service.dart';

class BiometricFatigueScreen extends StatefulWidget {
  const BiometricFatigueScreen({super.key});

  @override
  State<BiometricFatigueScreen> createState() => _BiometricFatigueScreenState();
}

class _BiometricFatigueScreenState extends State<BiometricFatigueScreen> {
  final BiometricFatigueService _service = BiometricFatigueService();
  FatigueState? _currentState;
  HosRoutingRecommendation? _emergencyRoute;
  bool _isMonitoring = false;
  final int _currentHosRemaining = 180; // 3 hours left

  void _startMonitoring() {
    setState(() {
      _isMonitoring = true;
    });

    _service.streamFatigueData().listen((state) async {
      if (mounted) {
        setState(() {
          _currentState = state;
        });

        if (state.isCritical && _emergencyRoute == null) {
          final route = await _service.getEmergencyReroute(_currentHosRemaining);
          if (mounted) {
            setState(() {
              _emergencyRoute = route;
            });
            _showEmergencyAlert();
          }
        }
      }
    });
  }

  void _showEmergencyAlert() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.red[900],
        title: const Row(
          children: [
            Icon(Icons.warning, color: Colors.white),
            SizedBox(width: 8),
            Text('CRITICAL FATIGUE', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: const Text(
          'Multiple microsleeps detected. You are at high risk of a collision. Pulling up nearest safe haven...',
          style: TextStyle(color: Colors.white),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('ACKNOWLEDGE', style: TextStyle(color: Colors.white)),
          )
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Biometric Fatigue Monitor'),
        backgroundColor: Colors.black,
      ),
      backgroundColor: Colors.grey[900],
      body: !_isMonitoring
          ? Center(
              child: ElevatedButton.icon(
                onPressed: _startMonitoring,
                icon: const Icon(Icons.camera_front),
                label: const Text('ENABLE ON-DEVICE VISION', style: TextStyle(fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.blueAccent,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16)
                ),
              ),
            )
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    if (_currentState == null) return const Center(child: CircularProgressIndicator(color: Colors.blueAccent));

    final s = _currentState!;
    
    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
          color: s.isCritical ? Colors.red[900] : Colors.black,
          child: Column(
            children: [
              Icon(s.isCritical ? Icons.front_hand : Icons.visibility, color: Colors.white, size: 80),
              const SizedBox(height: 16),
              Text(s.recommendedAction, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
              const SizedBox(height: 8),
              Text('Fatigue Index: ${s.overallFatigueScorePct.toInt()}%', style: const TextStyle(color: Colors.white70, fontSize: 18)),
            ],
          ),
        ),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _buildMetricRow('Blink Rate', '${s.blinkRatePerMinute.toInt()} / min', Icons.remove_red_eye),
                const SizedBox(height: 16),
                _buildMetricRow('Head Nods', '${s.headNodCount.toInt()} detected', Icons.face),
                const SizedBox(height: 16),
                _buildMetricRow('HOS Remaining', '${_currentHosRemaining} min', Icons.timer),
                
                if (_emergencyRoute != null) ...[
                  const SizedBox(height: 32),
                  _buildEmergencyRerouteCard(_emergencyRoute!),
                ]
              ],
            ),
          ),
        )
      ],
    );
  }

  Widget _buildMetricRow(String title, String value, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.grey[800], borderRadius: BorderRadius.circular(12)),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Icon(icon, color: Colors.blueAccent),
              const SizedBox(width: 12),
              Text(title, style: const TextStyle(color: Colors.white70, fontSize: 16)),
            ],
          ),
          Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
        ],
      ),
    );
  }

  Widget _buildEmergencyRerouteCard(HosRoutingRecommendation r) {
    return Card(
      color: Colors.yellow[100],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Colors.orange, width: 2)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.local_hospital, color: Colors.red),
                SizedBox(width: 8),
                Text('EMERGENCY SAFE HAVEN', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.red)),
              ],
            ),
            const Divider(height: 24),
            Text(r.locationName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text('${r.distanceMiles} miles ahead', style: TextStyle(color: Colors.grey[800])),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () {},
                icon: const Icon(Icons.navigation),
                label: const Text('REROUTE TO TRUCK STOP'),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.red[900], foregroundColor: Colors.white),
              ),
            )
          ],
        ),
      ),
    );
  }
}
