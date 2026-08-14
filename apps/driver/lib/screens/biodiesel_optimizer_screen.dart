import 'package:flutter/material.dart';
import '../models/biodiesel_optimizer_model.dart';
import '../services/biodiesel_optimizer_service.dart';

class BiodieselOptimizerScreen extends StatefulWidget {
  const BiodieselOptimizerScreen({super.key});

  @override
  State<BiodieselOptimizerScreen> createState() => _BiodieselOptimizerScreenState();
}

class _BiodieselOptimizerScreenState extends State<BiodieselOptimizerScreen> {
  final BiodieselOptimizerService _service = BiodieselOptimizerService();
  FuelOptimizationAnalysis? _analysis;

  @override
  void initState() {
    super.initState();
    _service.analysisStream.listen((data) {
      if (mounted) setState(() => _analysis = data);
    });
    _service.simulateFuelStopAnalysis();
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
        title: const Text('Biodiesel Blend Optimizer'),
        backgroundColor: Colors.teal[900],
      ),
      backgroundColor: Colors.grey[100],
      body: _analysis == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final a = _analysis!;
    
    if (a.availableBlends.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(color: Colors.teal),
            const SizedBox(height: 24),
            Text('Analyzing Route Weather...', style: TextStyle(color: Colors.teal[900], fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('Cross-referencing DPF health and cold-weather gelling risk.', style: TextStyle(color: Colors.grey)),
          ],
        ),
      );
    }

    return Column(
      children: [
        _buildContextHeader(a),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text('AVAILABLE PUMP OPTIONS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...a.availableBlends.map((blend) => _buildBlendCard(blend)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildContextHeader(FuelOptimizationAnalysis a) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.teal[800],
        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 8, offset: Offset(0, 4))],
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.ev_station, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              Text(a.locationName, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildHeaderMetric('Route Min Temp', '${a.routeMinTempF.toInt()}°F', Icons.ac_unit, Colors.lightBlueAccent),
              _buildHeaderMetric('Avg Engine Load', '${a.averageEngineLoadPct.toInt()}%', Icons.engineering, Colors.orangeAccent),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildHeaderMetric(String label, String value, IconData icon, Color color) {
    return Column(
      children: [
        Icon(icon, color: color, size: 28),
        const SizedBox(height: 8),
        Text(value, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
      ],
    );
  }

  Widget _buildBlendCard(FuelBlendOption b) {
    Color cardBorder = Colors.grey[300]!;
    Color statusColor = Colors.grey[700]!;
    IconData statusIcon = Icons.info;

    if (b.isRecommended) {
      cardBorder = Colors.green;
      statusColor = Colors.green[700]!;
      statusIcon = Icons.check_circle;
    } else if (b.safetyStatus == 'Risk of Gelling') {
      cardBorder = Colors.redAccent;
      statusColor = Colors.red;
      statusIcon = Icons.ac_unit;
    }

    return Card(
      elevation: b.isRecommended ? 8 : 2,
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: cardBorder, width: b.isRecommended ? 3 : 1),
      ),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          color: b.isRecommended ? Colors.green[50] : Colors.white,
        ),
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (b.isRecommended)
              Container(
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(color: Colors.green, borderRadius: BorderRadius.circular(12)),
                child: const Text('RECOMMENDED (MAX SAVINGS & SAFETY)', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
              ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(b.blendName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                Text('\$${b.pricePerGallon.toStringAsFixed(2)}/gal', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.teal)),
              ],
            ),
            const Divider(height: 24),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(statusIcon, color: statusColor, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(b.safetyStatus, style: TextStyle(color: statusColor, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Text(b.reason, style: TextStyle(color: Colors.grey[800], fontSize: 14)),
                    ],
                  ),
                )
              ],
            )
          ],
        ),
      ),
    );
  }
}
