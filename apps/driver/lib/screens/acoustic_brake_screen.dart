import 'package:flutter/material.dart';
import '../models/acoustic_brake_model.dart';
import '../services/acoustic_brake_service.dart';

class AcousticBrakeScreen extends StatefulWidget {
  const AcousticBrakeScreen({super.key});

  @override
  State<AcousticBrakeScreen> createState() => _AcousticBrakeScreenState();
}

class _AcousticBrakeScreenState extends State<AcousticBrakeScreen> {
  final AcousticBrakeService _service = AcousticBrakeService();
  AcousticBrakeSession? _session;

  @override
  void initState() {
    super.initState();
    _service.brakeStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateBrakingEvent();
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
        title: const Text('Acoustic Brake Diagnostics'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;

    bool hasCritical = s.wheelStatuses.any((w) => w.healthStatus == 'Critical');

    return Column(
      children: [
        _buildStatusHeader(s, hasCritical),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildTelemetryCard(s),
              const SizedBox(height: 24),
              const Text('WHEEL AXLE THICKNESS ESTIMATES', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...s.wheelStatuses.map((w) => _buildWheelCard(w, s.isBraking)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(AcousticBrakeSession s, bool hasCritical) {
    Color headerColor;
    IconData icon;
    
    if (s.isBraking) {
      headerColor = Colors.orange[800]!;
      icon = Icons.graphic_eq;
    } else if (hasCritical) {
      headerColor = Colors.red[900]!;
      icon = Icons.warning;
    } else {
      headerColor = Colors.blueGrey[800]!;
      icon = Icons.mic;
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
              const Text('AI ACOUSTIC LISTENER', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isBraking) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildTelemetryCard(AcousticBrakeSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Vehicle Speed', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text('${s.currentSpeedMph.toInt()} MPH', style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: s.isBraking ? Colors.orange : Colors.blueGrey)),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                const Text('Fleet Avg Thickness', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text('${s.averageThicknessMm.toStringAsFixed(1)} mm', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.grey)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildWheelCard(WheelBrakeStatus w, bool isBraking) {
    bool isCritical = w.healthStatus == 'Critical';
    bool isWarning = w.healthStatus == 'Warning';

    Color statusColor = isCritical ? Colors.red : (isWarning ? Colors.orange : Colors.green);

    return Card(
      elevation: isCritical ? 4 : 1,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isCritical ? Colors.red : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(Icons.tire_repair, color: statusColor),
                    const SizedBox(width: 12),
                    Text(w.position, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                Text('${w.estimatedThicknessMm.toStringAsFixed(1)} mm', style: TextStyle(color: statusColor, fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const SizedBox(height: 12),
            LinearProgressIndicator(
              value: w.estimatedThicknessMm / 20.0, // Assuming 20mm is brand new
              backgroundColor: Colors.grey[200],
              color: statusColor,
              minHeight: 8,
              borderRadius: BorderRadius.circular(4),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: isBraking ? Colors.orange[50] : Colors.grey[100], borderRadius: BorderRadius.circular(4)),
              child: Row(
                children: [
                  Icon(isBraking ? Icons.graphic_eq : Icons.history, size: 16, color: isBraking ? Colors.orange : Colors.blueGrey),
                  const SizedBox(width: 8),
                  Text(w.acousticSignature, style: TextStyle(fontFamily: 'monospace', color: isCritical ? Colors.red[900] : Colors.blueGrey, fontSize: 12, fontWeight: isCritical ? FontWeight.bold : FontWeight.normal)),
                ],
              ),
            )
          ],
        ),
      ),
    );
  }
}
