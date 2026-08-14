import 'package:flutter/material.dart';
import '../models/hyperspectral_imaging_model.dart';
import '../services/hyperspectral_imaging_service.dart';

class HyperspectralImagingScreen extends StatefulWidget {
  const HyperspectralImagingScreen({super.key});

  @override
  State<HyperspectralImagingScreen> createState() => _HyperspectralImagingScreenState();
}

class _HyperspectralImagingScreenState extends State<HyperspectralImagingScreen> {
  final HyperspectralImagingService _service = HyperspectralImagingService();
  HyperspectralSession? _session;

  @override
  void initState() {
    super.initState();
    _service.scannerStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateProduceScan();
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
        title: const Text('Hyperspectral AI Scanner'),
        backgroundColor: Colors.deepPurple[900],
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
              if (s.isScanning)
                _buildScanningLens()
              else if (s.analysis != null) ...[
                _buildFreshnessCard(s.analysis!),
                const SizedBox(height: 24),
                const Text('CELLULAR TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                _buildTelemetryRow('Cellular H₂O', '${s.analysis!.waterContentPercent}%', Icons.water_drop, Colors.blue),
                const SizedBox(height: 8),
                _buildTelemetryRow('Chlorophyll Decay', '${s.analysis!.chlorophyllDegradationIndex}', Icons.eco, Colors.green),
                const SizedBox(height: 8),
                _buildTelemetryRow('Internal Bruising', '${s.analysis!.internalBruisingPercent}%', Icons.coronavirus, Colors.red),
                const SizedBox(height: 24),
                if (s.forensicHash != null) _buildForensicSealCard(s.forensicHash!),
              ],
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(HyperspectralSession s) {
    bool isComplete = !s.isScanning && s.analysis != null;
    Color headerColor = isComplete ? Colors.green[800]! : Colors.deepPurple[800]!;
    IconData icon = isComplete ? Icons.verified : Icons.document_scanner;

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
              const Text('FORENSIC COMMODITY SCAN', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isScanning) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildScanningLens() {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: const Padding(
        padding: EdgeInsets.all(48),
        child: Column(
          children: [
            Icon(Icons.center_focus_weak, size: 80, color: Colors.deepPurple),
            SizedBox(height: 24),
            Text('Point camera at pallets', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            SizedBox(height: 8),
            Text('Capturing non-visible infrared wavelengths...', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
          ],
        ),
      ),
    );
  }

  Widget _buildFreshnessCard(ProduceAnalysis a) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Colors.green, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Text(a.commodity, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
            const Divider(height: 32),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(12)),
              child: Text(a.freshnessGrade, style: TextStyle(color: Colors.green[800], fontSize: 24, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTelemetryRow(String label, String value, IconData icon, Color color) {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: Icon(icon, color: color),
        title: Text(label),
        trailing: Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
      ),
    );
  }

  Widget _buildForensicSealCard(String hash) {
    return Card(
      color: Colors.grey[900],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.lock, color: Colors.yellow, size: 16),
                SizedBox(width: 8),
                Text('LEGAL DEFENSE SEAL GENERATED', style: TextStyle(color: Colors.yellow, fontWeight: FontWeight.bold, fontSize: 12, letterSpacing: 1.2)),
              ],
            ),
            const SizedBox(height: 8),
            Text(hash, style: const TextStyle(color: Colors.white54, fontFamily: 'monospace', fontSize: 12)),
          ],
        ),
      ),
    );
  }
}
