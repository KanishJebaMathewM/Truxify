import 'package:flutter/material.dart';
import '../models/kers_model.dart';
import '../services/kers_service.dart';

class KersScreen extends StatefulWidget {
  const KersScreen({super.key});

  @override
  State<KersScreen> createState() => _KersScreenState();
}

class _KersScreenState extends State<KersScreen> {
  final KersService _service = KersService();
  KersSession? _session;

  @override
  void initState() {
    super.initState();
    _service.kersStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateMountainDescent();
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
        title: const Text('KERS Harvesting AI'),
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

    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildGradeCard(s.gradePercentage),
              const SizedBox(height: 24),
              const Text('ENERGY RECOVERY GAMIFICATION', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildRegenGauge(s.telemetry.regenPowerKw),
              const SizedBox(height: 12),
              _buildFrictionGauge(s.telemetry.frictionBrakeTempF, s.isFrictionWarning),
              const SizedBox(height: 24),
              _buildBatteryCard(s.telemetry.batteryChargePercent),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(KersSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isFrictionWarning) {
      headerColor = Colors.orange[900]!;
      icon = Icons.warning;
    } else if (s.isRegenActive) {
      headerColor = Colors.green[800]!;
      icon = Icons.bolt;
    } else {
      headerColor = Colors.teal[800]!;
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
              const Text('KINETIC HARVESTER', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isFrictionWarning) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(8)),
              child: const Text('COACHING: RELEASE SERVICE BRAKES', style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold)),
            )
          ]
        ],
      ),
    );
  }

  Widget _buildGradeCard(double grade) {
    bool isDownhill = grade < 0;
    
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('TOPOLOGY GRADE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                Text('${grade.abs()}% ${isDownhill ? 'Descent' : 'Incline'}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 24)),
              ],
            ),
            Icon(isDownhill ? Icons.trending_down : Icons.trending_flat, size: 48, color: isDownhill ? Colors.green : Colors.blueGrey),
          ],
        ),
      ),
    );
  }

  Widget _buildRegenGauge(double kw) {
    double maxKw = 400.0;
    double progress = (kw / maxKw).clamp(0.0, 1.0);
    
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: Colors.green, width: 2)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Regenerative Braking', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                Text('+${kw.toInt()} kW', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: Colors.green[800])),
              ],
            ),
            const SizedBox(height: 12),
            LinearProgressIndicator(
              value: progress,
              backgroundColor: Colors.grey[200],
              color: Colors.green,
              minHeight: 16,
              borderRadius: BorderRadius.circular(8),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFrictionGauge(double temp, bool isWarning) {
    double maxTemp = 600.0;
    double progress = (temp / maxTemp).clamp(0.0, 1.0);
    
    return Card(
      elevation: isWarning ? 4 : 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: isWarning ? Colors.orange : Colors.transparent, width: 2)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Friction Brake Temp', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                Text('${temp.toInt()}°F', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: isWarning ? Colors.orange[900] : Colors.blueGrey)),
              ],
            ),
            const SizedBox(height: 12),
            LinearProgressIndicator(
              value: progress,
              backgroundColor: Colors.grey[200],
              color: isWarning ? Colors.orange : Colors.blueGrey,
              minHeight: 16,
              borderRadius: BorderRadius.circular(8),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBatteryCard(double charge) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.teal[50],
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.teal, width: 2),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              const Icon(Icons.battery_charging_full, color: Colors.teal, size: 32),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('HYBRID BATTERY', style: TextStyle(color: Colors.teal[900], fontWeight: FontWeight.bold, fontSize: 12)),
                  const Text('State of Charge', style: TextStyle(fontWeight: FontWeight.bold)),
                ],
              ),
            ],
          ),
          Text('${charge.toStringAsFixed(1)}%', style: TextStyle(color: Colors.teal[900], fontWeight: FontWeight.bold, fontSize: 32)),
        ],
      ),
    );
  }
}
