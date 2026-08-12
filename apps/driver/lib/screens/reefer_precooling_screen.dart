import 'package:flutter/material.dart';
import '../models/reefer_precooling_model.dart';
import '../services/reefer_precooling_service.dart';

class ReeferPreCoolingScreen extends StatefulWidget {
  const ReeferPreCoolingScreen({super.key});

  @override
  State<ReeferPreCoolingScreen> createState() => _ReeferPreCoolingScreenState();
}

class _ReeferPreCoolingScreenState extends State<ReeferPreCoolingScreen> {
  final ReeferPreCoolingService _service = ReeferPreCoolingService();
  PreCoolingSession? _session;

  @override
  void initState() {
    super.initState();
    _service.coolingStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulatePreCooling();
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
        title: const Text('Dynamic Reefer Pre-Cooling'),
        backgroundColor: Colors.blue[800],
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
              _buildShipperSyncCard(s),
              const SizedBox(height: 24),
              const Text('THERMO KING TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildTelemetryGrid(s.telemetry),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(PreCoolingSession s) {
    Color headerColor = Colors.grey[800]!;
    IconData icon = Icons.thermostat;
    
    if (s.telemetry.status == 'Pre-cooling Active') {
      headerColor = Colors.blue[700]!;
      icon = Icons.ac_unit;
    } else if (s.telemetry.status == 'Ready - Target Achieved') {
      headerColor = Colors.green[700]!;
      icon = Icons.check_circle;
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
              Text(s.telemetry.status.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildLargeTempMetric('Current Temp', s.telemetry.currentTempF),
              const Icon(Icons.arrow_forward, color: Colors.white54, size: 32),
              _buildLargeTempMetric('Target Temp', s.telemetry.targetTempF),
            ],
          )
        ],
      ),
    );
  }
  
  Widget _buildLargeTempMetric(String label, double temp) {
    return Column(
      children: [
        Text('${temp.toInt()}°F', style: const TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.bold)),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 14)),
      ],
    );
  }

  Widget _buildShipperSyncCard(PreCoolingSession s) {
    bool isSyncing = s.autoSyncEnabled;
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(Icons.storefront, color: Colors.blue[900]),
                    const SizedBox(width: 8),
                    Text(s.shipperName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                Icon(isSyncing ? Icons.sync : Icons.sync_disabled, color: isSyncing ? Colors.blue : Colors.grey)
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('${s.etaMinutes} min', 'Driver ETA', Colors.orange[800]!),
                _buildMetric('${s.telemetry.timeToTargetMinutes} min', 'Required Cooling Time', Colors.blue[700]!),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTelemetryGrid(ReeferTelemetry t) {
    return Row(
      children: [
        Expanded(
          child: Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Icon(Icons.local_shipping, color: Colors.grey[700]),
                  const SizedBox(height: 8),
                  Text(t.trailerId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  const Text('Trailer ID', style: TextStyle(color: Colors.grey, fontSize: 12)),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Icon(Icons.power, color: t.status != 'Idle - Monitoring ETA' ? Colors.green : Colors.grey[400]),
                  const SizedBox(height: 8),
                  Text(t.status != 'Idle - Monitoring ETA' ? 'RUNNING' : 'STANDBY', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: t.status != 'Idle - Monitoring ETA' ? Colors.green : Colors.grey)),
                  const Text('Compressor', style: TextStyle(color: Colors.grey, fontSize: 12)),
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
