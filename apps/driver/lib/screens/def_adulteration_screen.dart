import 'package:flutter/material.dart';
import '../models/def_adulteration_model.dart';
import '../services/def_adulteration_service.dart';

class DefAdulterationScreen extends StatefulWidget {
  const DefAdulterationScreen({super.key});

  @override
  State<DefAdulterationScreen> createState() => _DefAdulterationScreenState();
}

class _DefAdulterationScreenState extends State<DefAdulterationScreen> {
  final DefAdulterationService _service = DefAdulterationService();
  DefSession? _session;

  @override
  void initState() {
    super.initState();
    _service.defStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateRefueling();
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
        title: const Text('DEF Adulteration Firewall'),
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

    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text('CHEMICAL COMPOSITION ANALYSIS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildCompositionCard(s.currentSample),
              const SizedBox(height: 24),
              const Text('MECHANICAL FIREWALL', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildValveCard(s.isIntakeValveLocked),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(DefSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isIntakeValveLocked) {
      headerColor = Colors.red[900]!;
      icon = Icons.block;
    } else if (s.isAnalyzing) {
      headerColor = Colors.orange[800]!;
      icon = Icons.science;
    } else {
      headerColor = Colors.blue[800]!;
      icon = Icons.water_drop;
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
              const Text('SCR EMISSIONS FIREWALL', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isAnalyzing) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildCompositionCard(DefSample sample) {
    bool isUreaGood = sample.ureaConcentration >= 32.0 && sample.ureaConcentration <= 33.0;
    bool isMineralGood = sample.mineralContamination < 1.0;
    
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            _buildMetricBar('Urea Concentration (Target 32.5%)', '${sample.ureaConcentration.toStringAsFixed(1)}%', sample.ureaConcentration / 40.0, isUreaGood ? Colors.blue : Colors.red),
            const SizedBox(height: 16),
            _buildMetricBar('Deionized Water Content', '${sample.waterContent.toStringAsFixed(1)}%', sample.waterContent / 100.0, Colors.lightBlue),
            const SizedBox(height: 16),
            _buildMetricBar('Mineral Contaminants', '${sample.mineralContamination.toStringAsFixed(1)}%', (sample.mineralContamination / 5.0).clamp(0.0, 1.0), isMineralGood ? Colors.green : Colors.red),
          ],
        ),
      ),
    );
  }

  Widget _buildMetricBar(String label, String value, double progress, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.blueGrey)),
            Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: color)),
          ],
        ),
        const SizedBox(height: 8),
        LinearProgressIndicator(
          value: progress,
          backgroundColor: Colors.grey[200],
          color: color,
          minHeight: 12,
          borderRadius: BorderRadius.circular(6),
        ),
      ],
    );
  }

  Widget _buildValveCard(bool isLocked) {
    return Card(
      elevation: isLocked ? 8 : 1,
      color: isLocked ? Colors.red[50] : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isLocked ? Colors.red : Colors.grey[300]!, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                Icon(isLocked ? Icons.lock : Icons.lock_open, color: isLocked ? Colors.red : Colors.green, size: 36),
                const SizedBox(width: 16),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('INTAKE VALVE', style: TextStyle(color: isLocked ? Colors.red[900] : Colors.blueGrey, fontWeight: FontWeight.bold)),
                    Text(isLocked ? 'ISOLATED' : 'OPEN', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: isLocked ? Colors.red : Colors.green)),
                  ],
                ),
              ],
            ),
            if (isLocked)
              const Icon(Icons.warning, color: Colors.red, size: 36)
          ],
        ),
      ),
    );
  }
}
