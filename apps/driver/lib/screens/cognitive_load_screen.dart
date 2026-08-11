import 'package:flutter/material.dart';
import '../models/cognitive_load_model.dart';
import '../services/cognitive_load_service.dart';

class CognitiveLoadScreen extends StatefulWidget {
  const CognitiveLoadScreen({super.key});

  @override
  State<CognitiveLoadScreen> createState() => _CognitiveLoadScreenState();
}

class _CognitiveLoadScreenState extends State<CognitiveLoadScreen> {
  final CognitiveLoadService _service = CognitiveLoadService();
  CognitiveLoadSession? _session;

  @override
  void initState() {
    super.initState();
    _service.loadStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateDrivingEnvironment();
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
        title: const Text('Cognitive Load Engine'),
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
              const Text('SUPPRESSED NOTIFICATION QUEUE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (!s.isHighStressActive)
                _buildNormalStateCard()
              else if (s.queuedItems.isEmpty)
                _buildActiveMonitoringCard()
              else
                ...s.queuedItems.map((item) => _buildQueueItem(item)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(CognitiveLoadSession s) {
    Color headerColor = s.isHighStressActive ? Colors.deepOrange[800]! : Colors.blueGrey[800]!;
    IconData icon = s.isHighStressActive ? Icons.do_not_disturb_on : Icons.psychology;

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
              const Text('CONTEXTUAL SILENCER', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isHighStressActive) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(12)),
              child: Text('${s.suppressedCount} BLOCKED', style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
            )
          ]
        ],
      ),
    );
  }

  Widget _buildTelemetryRow(CognitiveLoadSession s) {
    return Row(
      children: [
        Expanded(child: _buildTelemetryCard('Traffic Density', s.trafficDensity, Icons.traffic, s.isHighStressActive ? Colors.deepOrange : Colors.green)),
        const SizedBox(width: 12),
        Expanded(child: _buildTelemetryCard('Weather Data', s.weatherCondition, s.weatherCondition.contains('Rain') ? Icons.water_drop : Icons.wb_sunny, s.weatherCondition.contains('Rain') ? Colors.blue : Colors.orange)),
      ],
    );
  }

  Widget _buildTelemetryCard(String label, String value, IconData icon, Color iconColor) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Icon(icon, color: iconColor, size: 24),
            const SizedBox(height: 8),
            Text(value, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            const SizedBox(height: 4),
            Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  Widget _buildNormalStateCard() {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: const Padding(
        padding: EdgeInsets.all(32),
        child: Column(
          children: [
            Icon(Icons.check_circle_outline, color: Colors.green, size: 48),
            SizedBox(height: 16),
            Text('Low Stress Environment.', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            Text('All notifications will pass through normally.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
          ],
        ),
      ),
    );
  }

  Widget _buildActiveMonitoringCard() {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          children: [
            const CircularProgressIndicator(color: Colors.deepOrange),
            const SizedBox(height: 16),
            const Text('Focus on the road.', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.deepOrange)),
            Text('Non-critical alerts will be held in queue until conditions improve.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey[700])),
          ],
        ),
      ),
    );
  }

  Widget _buildQueueItem(QueuedNotification item) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: const Icon(Icons.notifications_paused, color: Colors.deepOrange),
        title: Text(item.title, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text('Source: ${item.source}'),
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(color: Colors.grey[200], borderRadius: BorderRadius.circular(8)),
          child: const Text('HELD', style: TextStyle(color: Colors.grey, fontSize: 10, fontWeight: FontWeight.bold)),
        ),
      ),
    );
  }
}
