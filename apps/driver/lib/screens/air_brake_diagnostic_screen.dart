import 'package:flutter/material.dart';
import '../models/air_brake_diagnostic_model.dart';
import '../services/air_brake_diagnostic_service.dart';

class AirBrakeDiagnosticScreen extends StatefulWidget {
  const AirBrakeDiagnosticScreen({super.key});

  @override
  State<AirBrakeDiagnosticScreen> createState() => _AirBrakeDiagnosticScreenState();
}

class _AirBrakeDiagnosticScreenState extends State<AirBrakeDiagnosticScreen> {
  final AirBrakeDiagnosticService _service = AirBrakeDiagnosticService();
  AirBrakeDiagnosticSession? _session;

  @override
  void initState() {
    super.initState();
    _service.diagnosticStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateDiagnosticScan();
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
        title: const Text('Air Brake Acoustic AI'),
        backgroundColor: Colors.teal[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;
    bool isComplete = !s.isScanning && s.detectedLeak != null;

    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildPressureGauge(s.systemPsi),
              const SizedBox(height: 24),
              const Text('ACOUSTIC ANALYSIS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.detectedLeak != null)
                _buildLeakCard(s.detectedLeak!, isComplete)
              else
                _buildScanningCard(),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(AirBrakeDiagnosticSession s) {
    bool isComplete = !s.isScanning && s.detectedLeak != null;
    Color headerColor = isComplete ? Colors.red[900]! : Colors.teal[800]!;
    IconData icon = isComplete ? Icons.error_outline : Icons.multitrack_audio;

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
              const Text('ACOUSTIC DIAGNOSTICS', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isScanning) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildPressureGauge(double psi) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('SYSTEM AIR PRESSURE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 20),
            Stack(
              alignment: Alignment.center,
              children: [
                SizedBox(
                  width: 150,
                  height: 150,
                  child: CircularProgressIndicator(
                    value: psi / 130.0,
                    backgroundColor: Colors.grey[200],
                    color: psi < 110 ? Colors.orange : Colors.green,
                    strokeWidth: 12,
                  ),
                ),
                Column(
                  children: [
                    Text('${psi.toStringAsFixed(1)}', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 32, color: psi < 110 ? Colors.orange[800] : Colors.green[800])),
                    const Text('PSI', style: TextStyle(color: Colors.grey, fontSize: 16, fontWeight: FontWeight.bold)),
                  ],
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildScanningCard() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          children: [
            const Icon(Icons.mic, size: 48, color: Colors.teal),
            const SizedBox(height: 16),
            const Text('Walk around the tractor-trailer.', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 8),
            Text('Analyzing high-frequency audio spectrum for compressed air escape signatures.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey[600])),
          ],
        ),
      ),
    );
  }

  Widget _buildLeakCard(AirBrakeLeak leak, bool isComplete) {
    bool isViolation = leak.severityPsiDropPerMin > 2.0;

    return Card(
      elevation: isComplete ? 8 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isComplete ? Colors.red : Colors.orange, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Row(
              children: [
                Icon(Icons.location_on, color: isComplete ? Colors.red : Colors.orange),
                const SizedBox(width: 8),
                Text(leak.locationArea, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.grey[800])),
              ],
            ),
            const Divider(height: 32),
            Text(leak.componentName, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                Column(
                  children: [
                    Text('${leak.severityPsiDropPerMin.toStringAsFixed(1)} psi/min', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: isViolation ? Colors.red : Colors.orange)),
                    const Text('Leak Severity', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
                Container(height: 40, width: 1, color: Colors.grey[300]),
                Column(
                  children: [
                    Text('${leak.acousticConfidence.toStringAsFixed(1)}%', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.teal[800])),
                    const Text('AI Confidence', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
              ],
            ),
            if (isComplete && isViolation) ...[
              const SizedBox(height: 24),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.red[50], borderRadius: BorderRadius.circular(8)),
                child: const Row(
                  children: [
                    Icon(Icons.warning, color: Colors.red, size: 20),
                    SizedBox(width: 8),
                    Expanded(child: Text('DOT Out-Of-Service Violation. Replace seal immediately before transit.', style: TextStyle(color: Colors.red, fontSize: 12, fontWeight: FontWeight.bold))),
                  ],
                ),
              )
            ]
          ],
        ),
      ),
    );
  }
}
