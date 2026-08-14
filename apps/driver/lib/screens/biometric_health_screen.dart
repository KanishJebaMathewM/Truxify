import 'package:flutter/material.dart';
import '../models/biometric_health_model.dart';
import '../services/biometric_health_service.dart';

class BiometricHealthScreen extends StatefulWidget {
  const BiometricHealthScreen({super.key});

  @override
  State<BiometricHealthScreen> createState() => _BiometricHealthScreenState();
}

class _BiometricHealthScreenState extends State<BiometricHealthScreen> {
  final BiometricHealthService _service = BiometricHealthService();
  HealthSession? _session;

  @override
  void initState() {
    super.initState();
    _service.healthStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateMedicalEmergency();
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
        title: const Text('Biometric Steering AI'),
        backgroundColor: Colors.teal[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
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
              _buildEcgChart(s.biometrics.ecgRhythm, s.isEmergencyActive),
              const SizedBox(height: 24),
              const Text('LIVE BIOMETRICS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _buildMetricCard('Heart Rate', '${s.biometrics.heartRateBpm}', 'BPM', s.biometrics.heartRateBpm > 100)),
                  const SizedBox(width: 12),
                  Expanded(child: _buildMetricCard('HRV', s.biometrics.hrvMs.toStringAsFixed(1), 'ms', s.biometrics.hrvMs < 30)),
                ],
              ),
              const SizedBox(height: 24),
              if (s.isAutonomousPullOverActive) _buildAutonomousInterventionCard(),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(HealthSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isAutonomousPullOverActive) {
      headerColor = Colors.red[900]!;
      icon = Icons.local_hospital;
    } else if (s.isEmergencyActive) {
      headerColor = Colors.orange[900]!;
      icon = Icons.warning;
    } else {
      headerColor = Colors.teal[800]!;
      icon = Icons.favorite;
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 500),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: headerColor,
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('MEDICAL TELEMETRY', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildEcgChart(String rhythm, bool isEmergency) {
    return Card(
      elevation: 4,
      color: Colors.black,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: isEmergency ? Colors.red : Colors.teal, width: 2)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('ECG RHYTHM', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                Icon(Icons.monitor_heart, color: isEmergency ? Colors.red : Colors.teal),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              height: 100,
              width: double.infinity,
              child: CustomPaint(
                painter: _MockEcgPainter(isEmergency: isEmergency),
              ),
            ),
            const SizedBox(height: 16),
            Text(rhythm, style: TextStyle(color: isEmergency ? Colors.redAccent : Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
  }

  Widget _buildMetricCard(String label, String value, String unit, bool isAlarm) {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isAlarm ? Colors.red : Colors.transparent, width: 2),
      ),
      color: isAlarm ? Colors.red[50] : Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Text(label, style: TextStyle(color: isAlarm ? Colors.red[900] : Colors.grey, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 32, color: isAlarm ? Colors.red[900] : Colors.black87)),
                const SizedBox(width: 4),
                Text(unit, style: TextStyle(color: isAlarm ? Colors.red : Colors.grey, padding: const EdgeInsets.only(bottom: 6))),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAutonomousInterventionCard() {
    return Card(
      color: Colors.red[900],
      elevation: 8,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Icon(Icons.car_crash, color: Colors.white, size: 48),
            const SizedBox(height: 16),
            const Text('AUTONOMOUS PULL-OVER ENGAGED', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            const Text('Bringing vehicle to a safe stop on the shoulder.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white70)),
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8)),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.phone_in_talk, color: Colors.red[900]),
                  const SizedBox(width: 8),
                  Text('911 EMS DISPATCHED', style: TextStyle(color: Colors.red[900], fontWeight: FontWeight.bold)),
                ],
              ),
            )
          ],
        ),
      ),
    );
  }
}

class _MockEcgPainter extends CustomPainter {
  final bool isEmergency;
  _MockEcgPainter({required this.isEmergency});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = isEmergency ? Colors.redAccent : Colors.tealAccent
      ..strokeWidth = 2.0
      ..style = PaintingStyle.stroke;

    final path = Path();
    double w = size.width;
    double h = size.height;
    double yCenter = h / 2;

    path.moveTo(0, yCenter);
    
    if (isEmergency) {
      // Chaotic V-Tach pattern
      for (int i = 0; i < 10; i++) {
        double x = (w / 10) * i;
        path.lineTo(x + 10, yCenter - 40);
        path.lineTo(x + 20, yCenter + 30);
        path.lineTo(x + 30, yCenter - 20);
        path.lineTo(x + 40, yCenter);
      }
    } else {
      // Normal Sinus pattern
      for (int i = 0; i < 4; i++) {
        double x = (w / 4) * i;
        path.lineTo(x + 20, yCenter);
        path.lineTo(x + 25, yCenter - 10); // P wave
        path.lineTo(x + 30, yCenter);
        path.lineTo(x + 40, yCenter);
        path.lineTo(x + 45, yCenter + 20); // Q
        path.lineTo(x + 50, yCenter - 40); // R
        path.lineTo(x + 55, yCenter + 10); // S
        path.lineTo(x + 60, yCenter);
        path.lineTo(x + 70, yCenter);
        path.lineTo(x + 75, yCenter - 15); // T wave
        path.lineTo(x + 80, yCenter);
        path.lineTo(x + (w / 4), yCenter);
      }
    }

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
