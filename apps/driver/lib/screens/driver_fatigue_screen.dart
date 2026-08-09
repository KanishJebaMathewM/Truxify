import 'package:flutter/material.dart';
import '../models/driver_fatigue_model.dart';
import '../services/driver_fatigue_service.dart';

class DriverFatigueScreen extends StatefulWidget {
  const DriverFatigueScreen({super.key});

  @override
  State<DriverFatigueScreen> createState() => _DriverFatigueScreenState();
}

class _DriverFatigueScreenState extends State<DriverFatigueScreen> {
  final DriverFatigueService _service = DriverFatigueService();
  FatigueSession? _session;

  @override
  void initState() {
    super.initState();
    _service.fatigueStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateFatigueTracking();
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
        title: const Text('Ocular Fatigue Tracking'),
        backgroundColor: Colors.black,
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;
    bool isCritical = s.status.contains('CRITICAL');
    bool isWarning = s.status.contains('Warning');

    return Column(
      children: [
        _buildStatusHeader(s, isWarning, isCritical),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildActionCard(s, isCritical),
              const SizedBox(height: 24),
              const Text('INFRARED OCULAR TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildTelemetryGrid(s.ocularData, isCritical),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(FatigueSession s, bool isWarning, bool isCritical) {
    Color headerColor = Colors.green[800]!;
    IconData icon = Icons.visibility;
    
    if (isWarning) {
      headerColor = Colors.orange[800]!;
      icon = Icons.visibility_off;
    } else if (isCritical) {
      headerColor = Colors.red[900]!;
      icon = Icons.airline_seat_flat;
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
              const Text('IR DRIVER CAMERA', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 2)),
            ],
          ),
          const SizedBox(height: 24),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          LinearProgressIndicator(
            value: s.fatigueScore / 100,
            backgroundColor: Colors.white24,
            color: Colors.white,
            minHeight: 8,
          ),
          const SizedBox(height: 8),
          Text('Fatigue Score: ${s.fatigueScore.toInt()}/100', style: const TextStyle(color: Colors.white70, fontSize: 12)),
        ],
      ),
    );
  }

  Widget _buildActionCard(FatigueSession s, bool isCritical) {
    return Card(
      elevation: isCritical ? 8 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isCritical ? Colors.redAccent : Colors.transparent, width: 2),
      ),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: isCritical ? Colors.red[50] : Colors.white,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          children: [
            Text('SYSTEM DIRECTIVE', style: TextStyle(color: isCritical ? Colors.red[900] : Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (isCritical) ...[
                  const Icon(Icons.notifications_active, color: Colors.red, size: 32),
                  const SizedBox(width: 12),
                ],
                Expanded(
                  child: Text(s.recommendedAction, textAlign: TextAlign.center, style: TextStyle(color: isCritical ? Colors.red[900] : Colors.black87, fontSize: 18, fontWeight: FontWeight.bold)),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTelemetryGrid(OcularTelemetry t, bool isCritical) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(child: _buildMetricCard('Blink Rate', '${t.blinkRatePerMinute.toInt()} /min', Icons.remove_red_eye, t.blinkRatePerMinute < 10 || t.blinkRatePerMinute > 25)),
            const SizedBox(width: 12),
            Expanded(child: _buildMetricCard('Eye Closure', '${t.averageEyeClosureDurationMs.toInt()} ms', Icons.timer, t.averageEyeClosureDurationMs > 300)),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _buildMetricCard('Head Drop', '${t.headNodAngleDegrees.toStringAsFixed(1)}°', Icons.face, t.headNodAngleDegrees > 15)),
            const SizedBox(width: 12),
            Expanded(
              child: Card(
                color: isCritical ? Colors.red[900] : Colors.grey[100],
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Icon(isCritical ? Icons.warning : Icons.check_circle, color: isCritical ? Colors.white : Colors.green),
                      const SizedBox(height: 8),
                      Text(isCritical ? 'MICROSLEEP' : 'AWAKE', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: isCritical ? Colors.white : Colors.black87)),
                      Text('Biological State', style: TextStyle(color: isCritical ? Colors.white70 : Colors.grey, fontSize: 12)),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildMetricCard(String label, String value, IconData icon, bool isAnomalous) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isAnomalous ? Colors.orangeAccent : Colors.grey[200]!),
      ),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isAnomalous ? Colors.orange[50] : Colors.white,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Icon(icon, color: isAnomalous ? Colors.orange[900] : Colors.blueGrey[400]),
            const SizedBox(height: 8),
            Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 22, color: isAnomalous ? Colors.orange[900] : Colors.black87)),
            Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}
