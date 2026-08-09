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
  AcousticAnalysisStatus? _status;

  @override
  void initState() {
    super.initState();
    _service.analysisStream.listen((data) {
      if (mounted) setState(() => _status = data);
    });
    _service.simulateDriving();
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
        title: const Text('AI Acoustic Tire Analysis'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[900],
      body: _status == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    return Column(
      children: [
        _buildListeningBanner(),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: _status!.tireData.length,
            itemBuilder: (context, index) {
              return _buildTireCard(_status!.tireData[index]);
            },
          ),
        ),
      ],
    );
  }

  Widget _buildListeningBanner() {
    if (_status!.hasCriticalWarning) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        color: Colors.redAccent,
        child: const Column(
          children: [
            Icon(Icons.warning, color: Colors.white, size: 48),
            SizedBox(height: 16),
            Text('CRITICAL HARMONIC SHIFT DETECTED', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18, letterSpacing: 1.2)),
            SizedBox(height: 8),
            Text('PULL OVER IMMEDIATELY. Tread separation imminent.', style: TextStyle(color: Colors.white, fontSize: 16)),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: Colors.black,
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.greenAccent, strokeWidth: 2)),
          SizedBox(width: 16),
          Text('LISTENING TO TIRE HARMONICS...', style: TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.bold, letterSpacing: 2)),
        ],
      ),
    );
  }

  Widget _buildTireCard(TireHarmonicData tire) {
    final isCritical = tire.status == 'CRITICAL';
    
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      color: Colors.black,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isCritical ? Colors.redAccent : Colors.grey[800]!, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(Icons.tire_repair, color: isCritical ? Colors.redAccent : Colors.grey),
                    const SizedBox(width: 12),
                    Text(tire.tirePosition, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(color: isCritical ? Colors.redAccent.withOpacity(0.2) : Colors.greenAccent.withOpacity(0.1), borderRadius: BorderRadius.circular(12)),
                  child: Text(tire.status, style: TextStyle(color: isCritical ? Colors.redAccent : Colors.greenAccent, fontWeight: FontWeight.bold)),
                )
              ],
            ),
            const Divider(color: Colors.white24, height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildFrequencyMetric('Frequency', '${tire.currentFrequencyHz.toInt()} Hz', isCritical ? Colors.redAccent : Colors.white),
                _buildFrequencyMetric('Baseline', '${tire.baselineFrequencyHz.toInt()} Hz', Colors.grey),
                _buildFrequencyMetric('Anomaly Score', '${(tire.anomalyScore * 100).toInt()}%', isCritical ? Colors.redAccent : Colors.greenAccent),
              ],
            ),
            if (isCritical) ...[
              const SizedBox(height: 16),
              LinearProgressIndicator(value: tire.anomalyScore, color: Colors.redAccent, backgroundColor: Colors.red[900]),
              const SizedBox(height: 8),
              const Text('Internal steel belt failure indicated by pitch shift.', style: TextStyle(color: Colors.redAccent, fontSize: 12)),
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildFrequencyMetric(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: color, fontSize: 24, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
