import 'package:flutter/material.dart';
import '../models/def_contamination_model.dart';
import '../services/def_contamination_service.dart';

class DefContaminationScreen extends StatefulWidget {
  const DefContaminationScreen({super.key});

  @override
  State<DefContaminationScreen> createState() => _DefContaminationScreenState();
}

class _DefContaminationScreenState extends State<DefContaminationScreen> {
  final DefContaminationService _service = DefContaminationService();
  DefSensorReading? _reading;

  @override
  void initState() {
    super.initState();
    _service.sensorStream.listen((data) {
      if (mounted) setState(() => _reading = data);
    });
    _service.simulateContaminationEvent();
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
        title: const Text('DEF Quality Monitor'),
        backgroundColor: Colors.black,
      ),
      backgroundColor: Colors.grey[900],
      body: _reading == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final r = _reading!;
    
    return Column(
      children: [
        _buildStatusHeader(r),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _buildGaugeCard('Urea Concentration', r.ureaConcentrationPct, 32.5, '%', r.isEngineKillRequired),
                const SizedBox(height: 16),
                _buildGaugeCard('NOx Reduction Efficiency', r.noxReductionEfficiencyPct, 95.0, '%', r.isEngineKillRequired),
                const SizedBox(height: 48),
                if (r.isEngineKillRequired)
                  _buildEngineKillWarning(),
              ],
            ),
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(DefSensorReading r) {
    Color headerColor = Colors.blue[800]!;
    IconData icon = Icons.check_circle;
    
    if (r.status == 'Warning') {
      headerColor = Colors.orange[800]!;
      icon = Icons.warning;
    } else if (r.isEngineKillRequired) {
      headerColor = Colors.red[900]!;
      icon = Icons.dangerous;
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 500),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: headerColor,
      child: Column(
        children: [
          Icon(icon, color: Colors.white, size: 56),
          const SizedBox(height: 16),
          Text(r.status.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 2)),
          const SizedBox(height: 8),
          Text(r.systemMessage, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 16)),
        ],
      ),
    );
  }

  Widget _buildGaugeCard(String label, double value, double target, String unit, bool isCritical) {
    bool isDanger = value < (target * 0.8);
    Color barColor = isDanger ? Colors.redAccent : Colors.lightBlueAccent;

    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(color: Colors.black, borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.grey[800]!)),
      child: Column(
        children: [
          Text(label.toUpperCase(), style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('${value.toStringAsFixed(1)}$unit', style: TextStyle(color: barColor, fontSize: 32, fontWeight: FontWeight.bold)),
              Text('Target: $target$unit', style: const TextStyle(color: Colors.grey)),
            ],
          ),
          const SizedBox(height: 16),
          LinearProgressIndicator(
            value: (value / 100).clamp(0.0, 1.0),
            backgroundColor: Colors.grey[900],
            color: barColor,
            minHeight: 12,
            borderRadius: BorderRadius.circular(6),
          ),
        ],
      ),
    );
  }

  Widget _buildEngineKillWarning() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(color: Colors.red[900]!.withOpacity(0.3), borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.redAccent)),
      child: Row(
        children: [
          Icon(Icons.power_settings_new, color: Colors.redAccent, size: 48),
          SizedBox(width: 24),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('KILL ENGINE NOW', style: TextStyle(color: Colors.redAccent, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                SizedBox(height: 4),
                Text('Do not let the contaminated fluid reach the SCR system. A \$15,000 repair bill is imminent.', style: TextStyle(color: Colors.white, fontSize: 14)),
              ],
            ),
          )
        ],
      ),
    );
  }
}
