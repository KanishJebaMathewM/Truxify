import 'package:flutter/material.dart';
import '../models/reefer_ai_model.dart';
import '../services/reefer_ai_service.dart';

class ReeferAiScreen extends StatefulWidget {
  const ReeferAiScreen({super.key});

  @override
  State<ReeferAiScreen> createState() => _ReeferAiScreenState();
}

class _ReeferAiScreenState extends State<ReeferAiScreen> {
  final ReeferAiService _service = ReeferAiService();
  ReeferAiSession? _session;

  @override
  void initState() {
    super.initState();
    _service.reeferStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateReeferMonitoring();
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
        title: const Text('Reefer Predictive AI'),
        backgroundColor: Colors.blue[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;
    bool isCritical = s.failureProbability > 80;
    bool isWarning = s.failureProbability > 20 && s.failureProbability <= 80;

    return Column(
      children: [
        _buildStatusHeader(s, isWarning, isCritical),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (s.systemDirective != null) ...[
                _buildDirectiveCard(s, isCritical),
                const SizedBox(height: 24),
              ],
              const Text('CARGO TEMPERATURE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildTempCard(s.telemetry, isCritical),
              const SizedBox(height: 24),
              const Text('PREDICTIVE DIAGNOSTICS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildDiagnosticsGrid(s.telemetry, isCritical),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(ReeferAiSession s, bool isWarning, bool isCritical) {
    Color headerColor = Colors.blue[800]!;
    IconData icon = Icons.ac_unit;
    
    if (isWarning) {
      headerColor = Colors.orange[800]!;
      icon = Icons.insights;
    } else if (isCritical) {
      headerColor = Colors.red[900]!;
      icon = Icons.warning_amber;
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
              const Text('THERMO KING IoT ENGINE', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          LinearProgressIndicator(
            value: s.failureProbability / 100,
            backgroundColor: Colors.white24,
            color: Colors.white,
            minHeight: 8,
          ),
          const SizedBox(height: 8),
          Text(
            'Failure Probability: ${s.failureProbability.toStringAsFixed(1)}%',
            style: const TextStyle(color: Colors.white70, fontSize: 12)
          ),
        ],
      ),
    );
  }

  Widget _buildTempCard(ReeferTelemetry t, bool isCritical) {
    double diff = t.currentTempFahrenheit - t.targetTempFahrenheit;
    Color diffColor = diff > 1.0 ? Colors.red : Colors.green;

    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            Column(
              children: [
                Text('${t.targetTempFahrenheit.toStringAsFixed(1)}°F', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.blue)),
                const Text('Target', style: TextStyle(color: Colors.grey)),
              ],
            ),
            Container(width: 2, height: 40, color: Colors.grey[300]),
            Column(
              children: [
                Text('${t.currentTempFahrenheit.toStringAsFixed(1)}°F', style: TextStyle(fontSize: 36, fontWeight: FontWeight.bold, color: diffColor)),
                Text('Current', style: TextStyle(color: diffColor, fontWeight: FontWeight.bold)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDiagnosticsGrid(ReeferTelemetry t, bool isCritical) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(child: _buildMetricCard('Freon Pressure', '${t.freonPressurePsi.toInt()} psi', Icons.compress, t.freonPressurePsi < 200)),
            const SizedBox(width: 12),
            Expanded(child: _buildMetricCard('Cycle Time', '${t.compressorCycleTimeMins.toInt()} min', Icons.timer, t.compressorCycleTimeMins > 30)),
          ],
        ),
        const SizedBox(height: 12),
        Card(
           elevation: 2,
           shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
           child: Padding(
             padding: const EdgeInsets.all(16),
             child: Row(
               mainAxisAlignment: MainAxisAlignment.spaceBetween,
               children: [
                 const Column(
                   crossAxisAlignment: CrossAxisAlignment.start,
                   children: [
                     Text('Ambient External Temp', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                     Text('Thermal load factor', style: TextStyle(color: Colors.grey, fontSize: 12)),
                   ],
                 ),
                 Text('${t.ambientTempFahrenheit.toInt()}°F', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: Colors.orange[800])),
               ],
             ),
           ),
        )
      ],
    );
  }

  Widget _buildMetricCard(String label, String value, IconData icon, bool isDanger) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isDanger ? Colors.redAccent : Colors.grey[200]!),
      ),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isDanger ? Colors.red[50] : Colors.white,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Icon(icon, color: isDanger ? Colors.red[900] : Colors.blueGrey[400]),
            const SizedBox(height: 8),
            Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: isDanger ? Colors.red[900] : Colors.black87)),
            Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  Widget _buildDirectiveCard(ReeferAiSession s, bool isCritical) {
    return Card(
      elevation: isCritical ? 8 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isCritical ? Colors.redAccent : Colors.orangeAccent, width: 2),
      ),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: isCritical ? Colors.red[50] : Colors.orange[50],
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          children: [
            Text('SYSTEM DIRECTIVE', style: TextStyle(color: isCritical ? Colors.red[900] : Colors.orange[900], fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(isCritical ? Icons.notifications_active : Icons.info, color: isCritical ? Colors.red : Colors.orange[800], size: 32),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(s.systemDirective!, style: TextStyle(color: isCritical ? Colors.red[900] : Colors.black87, fontSize: 16, fontWeight: FontWeight.bold)),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }
}
