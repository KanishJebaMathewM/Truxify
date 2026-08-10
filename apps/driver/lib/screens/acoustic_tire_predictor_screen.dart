import 'package:flutter/material.dart';
import '../models/acoustic_tire_predictor_model.dart';
import '../services/acoustic_tire_predictor_service.dart';

class AcousticTirePredictorScreen extends StatefulWidget {
  const AcousticTirePredictorScreen({super.key});

  @override
  State<AcousticTirePredictorScreen> createState() => _AcousticTirePredictorScreenState();
}

class _AcousticTirePredictorScreenState extends State<AcousticTirePredictorScreen> {
  final AcousticTirePredictorService _service = AcousticTirePredictorService();
  TireAcousticAnalysis? _analysis;

  @override
  void initState() {
    super.initState();
    _service.analysisStream.listen((data) {
      if (mounted) setState(() => _analysis = data);
    });
    _service.simulateAcousticAnalysis();
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
        title: const Text('Acoustic Tire AI Forensics'),
        backgroundColor: Colors.teal[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _analysis == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final a = _analysis!;
    
    return Column(
      children: [
        _buildStatusHeader(a),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (a.status.contains('Warning') || a.status.contains('Critical'))
                _buildAlertCard(a),
              const SizedBox(height: 24),
              const Text('LIVE HARMONIC FREQUENCIES', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...a.signatures.map((sig) => _buildSignatureCard(sig)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(TireAcousticAnalysis a) {
    Color headerColor = Colors.teal[800]!;
    IconData icon = Icons.hearing;
    
    if (a.status.contains('Warning')) {
      headerColor = Colors.orange[800]!;
      icon = Icons.warning_amber_rounded;
    } else if (a.status.contains('Critical')) {
      headerColor = Colors.red[900]!;
      icon = Icons.error_outline;
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
              const Text('ACOUSTIC SENSOR', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 24),
          Text(a.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
        ],
      ),
    );
  }

  Widget _buildAlertCard(TireAcousticAnalysis a) {
    bool isCritical = a.status.contains('Critical');
    
    return Card(
      elevation: 8,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: isCritical ? Colors.redAccent : Colors.orangeAccent, width: 2)),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(color: isCritical ? Colors.red[50] : Colors.orange[50], borderRadius: BorderRadius.circular(16)),
        child: Column(
          children: [
            Text('AFFECTED TIRE', style: TextStyle(color: isCritical ? Colors.red[800] : Colors.orange[900], fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 8),
            Text(a.activeTireLocation, textAlign: TextAlign.center, style: const TextStyle(color: Colors.black87, fontSize: 20, fontWeight: FontWeight.bold)),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildSmallMetric('Est. Failure In', '${a.estimatedMinutesToFailure} mins', isCritical ? Colors.red : Colors.orange[800]!),
                _buildSmallMetric('AI Confidence', '${a.confidencePct}%', Colors.black87),
              ],
            ),
            const SizedBox(height: 24),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 16),
              decoration: BoxDecoration(color: isCritical ? Colors.red[900] : Colors.orange[900], borderRadius: BorderRadius.circular(8)),
              child: const Text('PULL OVER IMMEDIATELY', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18, letterSpacing: 1.2)),
            )
          ],
        ),
      ),
    );
  }
  
  Widget _buildSmallMetric(String label, String value, Color valueColor) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: valueColor, fontSize: 24, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }

  Widget _buildSignatureCard(AcousticHarmonicSignature sig) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: sig.isAnomalous ? Colors.redAccent : Colors.grey[300]!)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: sig.isAnomalous ? Colors.red[50] : Colors.grey[100], borderRadius: BorderRadius.circular(8)),
              child: Icon(sig.isAnomalous ? Icons.graphic_eq : Icons.multitrack_audio, color: sig.isAnomalous ? Colors.red : Colors.grey),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${sig.frequencyHz.toInt()} Hz', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  const SizedBox(height: 4),
                  Text(sig.isAnomalous ? 'Anomalous High-Pitch Whine' : 'Normal Road Noise', style: TextStyle(color: sig.isAnomalous ? Colors.red : Colors.grey, fontSize: 12, fontWeight: sig.isAnomalous ? FontWeight.bold : FontWeight.normal)),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('${sig.amplitudeDb.toInt()} dB', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: sig.isAnomalous ? Colors.red : Colors.black87)),
                const Text('Amplitude', style: TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            )
          ],
        ),
      ),
    );
  }
}
