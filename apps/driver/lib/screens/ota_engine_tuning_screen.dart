import 'package:flutter/material.dart';
import '../models/ota_engine_tuning_model.dart';
import '../services/ota_engine_tuning_service.dart';

class OtaEngineTuningScreen extends StatefulWidget {
  const OtaEngineTuningScreen({super.key});

  @override
  State<OtaEngineTuningScreen> createState() => _OtaEngineTuningScreenState();
}

class _OtaEngineTuningScreenState extends State<OtaEngineTuningScreen> {
  final OtaEngineTuningService _service = OtaEngineTuningService();
  OtaTuningSession? _session;

  @override
  void initState() {
    super.initState();
    _service.tuningStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateTopographyChanges();
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
        title: const Text('Dynamic OTA ECM Tuning'),
        backgroundColor: Colors.deepOrange[900],
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
              _buildTopographyCard(s.ecm),
              const SizedBox(height: 24),
              const Text('LIVE ECM TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildTelemetryGrid(s.ecm),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(OtaTuningSession s) {
    Color headerColor = Colors.green[700]!;
    IconData icon = Icons.eco;
    
    if (s.status.contains('Flash')) {
      headerColor = Colors.orange[800]!;
      icon = Icons.wifi_protected_setup;
    } else if (s.status.contains('Mountain')) {
      headerColor = Colors.deepOrange[800]!;
      icon = Icons.landscape;
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
              Text(s.status.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(12)),
            child: Text('Active Map: ${s.ecm.activeTuneMap}', style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
          )
        ],
      ),
    );
  }

  Widget _buildTopographyCard(EngineEcmState ecm) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('AHEAD ON ROUTE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(Icons.terrain, color: Colors.deepOrange[900]),
                const SizedBox(width: 8),
                Text(ecm.nextTopographyEvent, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('${ecm.currentGradePct}%', 'Current Grade', Colors.black87),
                _buildMetric('${ecm.engineLoadPct}%', 'Engine Load', ecm.engineLoadPct > 90 ? Colors.red : Colors.black87),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTelemetryGrid(EngineEcmState ecm) {
    bool isPowerMode = ecm.activeTuneMap.contains('Mountain');
    
    return Row(
      children: [
        Expanded(
          child: Card(
            elevation: 2,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: isPowerMode ? Colors.deepOrange : Colors.transparent, width: 2)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Icon(Icons.speed, color: Colors.blueGrey[700]),
                  const SizedBox(height: 8),
                  Text('${ecm.maxTorqueLbFt}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 24)),
                  const Text('Max Torque (lb-ft)', style: TextStyle(color: Colors.grey, fontSize: 12)),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Card(
            elevation: 2,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: isPowerMode ? Colors.deepOrange : Colors.transparent, width: 2)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Icon(Icons.settings, color: Colors.blueGrey[700]),
                  const SizedBox(height: 8),
                  Text('${ecm.shiftPointRpm}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 24)),
                  const Text('Shift Point (RPM)', style: TextStyle(color: Colors.grey, fontSize: 12)),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildMetric(String value, String label, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: color, fontSize: 24, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
