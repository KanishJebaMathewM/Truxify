import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/dpf_regen_model.dart';
import '../services/dpf_regen_service.dart';

class DpfRegenScreen extends StatefulWidget {
  const DpfRegenScreen({super.key});

  @override
  State<DpfRegenScreen> createState() => _DpfRegenScreenState();
}

class _DpfRegenScreenState extends State<DpfRegenScreen> {
  final DpfRegenService _service = DpfRegenService();
  DpfRegenSession? _session;

  @override
  void initState() {
    super.initState();
    _service.regenStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateDpfMonitoring();
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
        title: const Text('DPF Emissions Engine'),
        backgroundColor: Colors.grey[900],
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
              _buildSootGauge(s.telemetry),
              const SizedBox(height: 24),
              const Text('EXHAUST TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildTelemetryGrid(s.telemetry, s.isRegenActive),
              const SizedBox(height: 24),
              if (s.predictedRegenTime != null) _buildSchedulerCard(s),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(DpfRegenSession s) {
    Color headerColor = Colors.grey[800]!;
    IconData icon = Icons.monitor_heart;
    
    if (s.isRegenActive) {
      headerColor = Colors.orange[900]!;
      icon = Icons.local_fire_department;
    } else if (s.telemetry.sootLoadPercentage > 85) {
      headerColor = Colors.red[900]!;
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
              const Text('ECM EMISSIONS AI', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildSootGauge(DpfTelemetry t) {
    double soot = t.sootLoadPercentage;
    Color gaugeColor = soot > 85 ? Colors.red : (soot > 65 ? Colors.orange : Colors.green);

    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('DPF SOOT LOAD', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 20),
            Stack(
              alignment: Alignment.center,
              children: [
                SizedBox(
                  width: 120,
                  height: 120,
                  child: CircularProgressIndicator(
                    value: soot / 100,
                    backgroundColor: Colors.grey[200],
                    color: gaugeColor,
                    strokeWidth: 12,
                  ),
                ),
                Column(
                  children: [
                    Text('${soot.toStringAsFixed(1)}%', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: gaugeColor)),
                    const Text('Capacity', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTelemetryGrid(DpfTelemetry t, bool isRegen) {
    return Row(
      children: [
        Expanded(child: _buildMetricCard('Exhaust Temp', '${t.exhaustTempFahrenheit.toInt()}°F', Icons.thermostat, isRegen ? Colors.orange[900]! : Colors.blueGrey)),
        const SizedBox(width: 12),
        Expanded(child: _buildMetricCard('Engine Load', '${t.engineLoadPercentage.toInt()}%', Icons.speed, Colors.blueGrey)),
      ],
    );
  }

  Widget _buildMetricCard(String label, String value, IconData icon, Color color) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Icon(icon, color: color),
            const SizedBox(height: 8),
            Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 22, color: color)),
            const SizedBox(height: 4),
            Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  Widget _buildSchedulerCard(DpfRegenSession s) {
    bool isRegen = s.isRegenActive;

    return Card(
      elevation: isRegen ? 8 : 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isRegen ? Colors.orange : Colors.indigo, width: 2),
      ),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: isRegen ? Colors.orange[50] : Colors.indigo[50],
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          children: [
            Row(
              children: [
                Icon(isRegen ? Icons.local_fire_department : Icons.bedtime, color: isRegen ? Colors.orange[900] : Colors.indigo[900]),
                const SizedBox(width: 12),
                Text(isRegen ? 'ACTIVE HIGH-IDLE' : 'SLEEPER BERTH SCHEDULER', style: TextStyle(color: isRegen ? Colors.orange[900] : Colors.indigo[900], fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              ],
            ),
            const Divider(height: 24),
            if (isRegen) ...[
              Text('${s.estimatedMinutesRemaining} MINS REMAINING', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.orange[900])),
              const SizedBox(height: 8),
              const Text('Burning particulate matter from DPF.', style: TextStyle(color: Colors.grey)),
            ] else ...[
              Text('Scheduled for: ${DateFormat('h:mm a').format(s.predictedRegenTime!)}', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.indigo[900])),
              const SizedBox(height: 8),
              const Text('Regen delayed to match HOS 10-hour mandatory rest period. No driving interruption.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey, fontSize: 14)),
            ]
          ],
        ),
      ),
    );
  }
}
