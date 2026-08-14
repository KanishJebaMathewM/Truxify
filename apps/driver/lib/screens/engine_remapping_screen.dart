import 'package:flutter/material.dart';
import '../models/engine_remapping_model.dart';
import '../services/engine_remapping_service.dart';

class EngineRemappingScreen extends StatefulWidget {
  const EngineRemappingScreen({super.key});

  @override
  State<EngineRemappingScreen> createState() => _EngineRemappingScreenState();
}

class _EngineRemappingScreenState extends State<EngineRemappingScreen> {
  final EngineRemappingService _service = EngineRemappingService();
  RemappingSession? _session;

  @override
  void initState() {
    super.initState();
    _service.mapStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateTopologyChange();
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
        title: const Text('Dynamic OTA Remapping'),
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
              _buildRegionCard(s),
              const SizedBox(height: 24),
              const Text('ACTIVE ENGINE ECM PROFILE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildTuneCard(s.activeTune, s.isFlashing),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(RemappingSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isFlashing) {
      headerColor = Colors.orange[800]!;
      icon = Icons.system_update_alt;
    } else if (s.activeTune.profileName.contains('Mountain')) {
      headerColor = Colors.deepPurple[900]!;
      icon = Icons.terrain;
    } else {
      headerColor = Colors.green[800]!;
      icon = Icons.eco;
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
              const Text('ECM TOPOLOGY SYNC', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isFlashing) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildRegionCard(RemappingSession s) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('GPS Topology Region', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text(s.currentRegion, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ],
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(color: s.upcomingGradePercent > 4.0 ? Colors.red[50] : Colors.blueGrey[50], borderRadius: BorderRadius.circular(8)),
              child: Text('${s.upcomingGradePercent.toStringAsFixed(1)}% Grade', style: TextStyle(color: s.upcomingGradePercent > 4.0 ? Colors.red[900] : Colors.blueGrey, fontWeight: FontWeight.bold)),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTuneCard(EngineTune tune, bool isFlashing) {
    bool isMountain = tune.profileName.contains('Mountain');

    return Card(
      elevation: isFlashing ? 1 : 8,
      color: isMountain ? Colors.deepPurple[50] : Colors.green[50],
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isFlashing ? Colors.orange : (isMountain ? Colors.deepPurple : Colors.green), width: 2),
      ),
      child: Opacity(
        opacity: isFlashing ? 0.5 : 1.0,
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              Text(tune.profileName.toUpperCase(), style: TextStyle(color: isMountain ? Colors.deepPurple[900] : Colors.green[900], fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const Divider(height: 32),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _buildSpecMetric('Max Power', '${tune.maxHorsepower} HP', isMountain ? Colors.deepPurple : Colors.green),
                  _buildSpecMetric('Peak Torque', '${tune.peakTorqueLbFt} lb-ft', isMountain ? Colors.deepPurple : Colors.green),
                ],
              ),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Transmission Logic', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.blueGrey)),
                  Text(tune.shiftingLogic, style: TextStyle(fontWeight: FontWeight.bold, color: isMountain ? Colors.deepPurple[900] : Colors.green[900])),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Jake Brake Profile', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.blueGrey)),
                  Text(tune.jakeBrakeProfile, style: TextStyle(fontWeight: FontWeight.bold, color: isMountain ? Colors.deepPurple[900] : Colors.green[900])),
                ],
              )
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSpecMetric(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: color, fontFamily: 'monospace')),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
      ],
    );
  }
}
