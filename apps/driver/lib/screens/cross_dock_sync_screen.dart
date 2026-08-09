import 'package:flutter/material.dart';
import '../models/cross_dock_sync_model.dart';
import '../services/cross_dock_sync_service.dart';

class CrossDockSyncScreen extends StatefulWidget {
  const CrossDockSyncScreen({super.key});

  @override
  State<CrossDockSyncScreen> createState() => _CrossDockSyncScreenState();
}

class _CrossDockSyncScreenState extends State<CrossDockSyncScreen> {
  final CrossDockSyncService _service = CrossDockSyncService();
  CrossDockSession? _session;

  @override
  void initState() {
    super.initState();
    _service.syncStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateSynchronization();
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
        title: const Text('JIT Cross-Dock Sync'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.blueGrey[50],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;
    Color statusColor = Colors.orange;
    if (s.status == 'Perfect Sync') statusColor = Colors.green;
    if (s.status == 'Synchronizing') statusColor = Colors.blue;

    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(24),
          color: statusColor,
          child: Column(
            children: [
              Text(s.status.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 2)),
              const SizedBox(height: 8),
              Text(s.adviceText, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 16)),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildFacilityHeader(s),
              const SizedBox(height: 24),
              _buildDeltaVisualizer(s, statusColor),
              const SizedBox(height: 24),
              const Text('LIVE TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
              const SizedBox(height: 8),
              _buildTruckCard(s.selfTruck, true),
              _buildTruckCard(s.partnerTruck, false),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildFacilityHeader(CrossDockSession s) {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ListTile(
        leading: Icon(Icons.compare_arrows, color: Colors.blueGrey[900], size: 36),
        title: Text(s.facilityName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        subtitle: Text(s.facilityLocation),
      ),
    );
  }

  Widget _buildDeltaVisualizer(CrossDockSession s, Color statusColor) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.grey[300]!)),
      child: Column(
        children: [
          const Text('ETA DELTA', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text('${s.syncDeltaMinutes}', style: TextStyle(color: statusColor, fontSize: 64, fontWeight: FontWeight.bold)),
              const SizedBox(width: 8),
              const Text('MINUTES', style: TextStyle(color: Colors.grey, fontSize: 18, fontWeight: FontWeight.bold)),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildTruckCard(TruckTelemetry t, bool isSelf) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: isSelf ? BorderSide(color: Colors.blueGrey[300]!, width: 2) : BorderSide.none),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(isSelf ? Icons.local_shipping : Icons.rv_hookup, color: Colors.blueGrey[700]),
                    const SizedBox(width: 8),
                    Text(t.truckId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(color: Colors.blueGrey[50], borderRadius: BorderRadius.circular(12)),
                  child: Text(t.role, style: TextStyle(color: Colors.blueGrey[900], fontWeight: FontWeight.bold, fontSize: 12)),
                )
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('Distance', '${t.distanceToDockMiles.toInt()} mi'),
                _buildMetric('Arrival ETA', '${t.estimatedArrivalMinutes} min'),
                _buildMetric('Target Speed', '${t.targetSpeedMph.toInt()} MPH', isHighlighted: true),
              ],
            ),
            if (isSelf && t.currentSpeedMph != t.targetSpeedMph) ...[
              const SizedBox(height: 16),
              LinearProgressIndicator(
                value: t.currentSpeedMph / 80,
                backgroundColor: Colors.grey[200],
                color: t.currentSpeedMph > t.targetSpeedMph ? Colors.red : Colors.orange,
              ),
              const SizedBox(height: 4),
              Text('Current Speed: ${t.currentSpeedMph.toInt()} MPH (Adjust to Target)', style: const TextStyle(color: Colors.red, fontSize: 12, fontWeight: FontWeight.bold)),
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, {bool isHighlighted = false}) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: isHighlighted ? Colors.blueGrey[900] : Colors.black87, fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
