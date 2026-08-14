import 'package:flutter/material.dart';
import '../models/black_ice_model.dart';
import '../services/black_ice_service.dart';

class BlackIceScreen extends StatefulWidget {
  const BlackIceScreen({super.key});

  @override
  State<BlackIceScreen> createState() => _BlackIceScreenState();
}

class _BlackIceScreenState extends State<BlackIceScreen> {
  final BlackIceService _service = BlackIceService();
  BlackIceSession? _session;

  @override
  void initState() {
    super.initState();
    _service.thermalStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateBridgeApproach();
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
        title: const Text('FLIR Black Ice Radar'),
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

    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildTelemetryRow(s),
              const SizedBox(height: 24),
              const Text('FORWARD THERMAL SCAN', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildThermalChart(s.thermalScanData),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(BlackIceSession s) {
    Color headerColor = s.isIceDetected ? Colors.blue[900]! : Colors.blueGrey[700]!;
    IconData icon = s.isIceDetected ? Icons.ac_unit : Icons.thermostat;
    
    // Make header flash if ice is detected
    if (s.isIceDetected && s.recommendedSpeedMph <= 25.0) {
      headerColor = Colors.red[900]!; // Shift to red for critical deceleration
      icon = Icons.warning;
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
              const Text('SURFACE TEMPERATURE AI', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isIceDetected) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(12)),
              child: Column(
                children: [
                  const Text('RECOMMENDED SPEED', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                  Text('${s.recommendedSpeedMph.toInt()} MPH', style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold)),
                ],
              ),
            )
          ]
        ],
      ),
    );
  }

  Widget _buildTelemetryRow(BlackIceSession s) {
    return Row(
      children: [
        Expanded(child: _buildInfoCard('Ambient Air', '${s.ambientTempF}°F', Icons.cloud, Colors.blueGrey)),
        const SizedBox(width: 12),
        Expanded(child: _buildInfoCard('Sensor Status', 'Active', Icons.camera_alt, Colors.green)),
      ],
    );
  }

  Widget _buildInfoCard(String label, String value, IconData icon, Color iconColor) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Icon(icon, color: iconColor, size: 28),
            const SizedBox(height: 8),
            Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  Widget _buildThermalChart(List<ThermalPoint> points) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: points.map((p) => _buildThermalBar(p)).toList(),
        ),
      ),
    );
  }

  Widget _buildThermalBar(ThermalPoint p) {
    bool isFreezing = p.surfaceTempF <= 32.0;
    
    // Normalize temperature for bar width (e.g., 20F to 40F range)
    double progress = ((p.surfaceTempF - 20) / 20).clamp(0.0, 1.0);

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        children: [
          SizedBox(
            width: 60,
            child: Text('${p.distanceAheadFeet.toInt()} ft', style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.grey)),
          ),
          Expanded(
            child: LinearProgressIndicator(
              value: progress,
              backgroundColor: Colors.grey[200],
              color: isFreezing ? Colors.blue : Colors.orange,
              minHeight: 12,
              borderRadius: BorderRadius.circular(6),
            ),
          ),
          const SizedBox(width: 16),
          SizedBox(
            width: 50,
            child: Text('${p.surfaceTempF.toStringAsFixed(1)}°', style: TextStyle(fontWeight: FontWeight.bold, color: isFreezing ? Colors.blue[900] : Colors.black87)),
          ),
        ],
      ),
    );
  }
}
