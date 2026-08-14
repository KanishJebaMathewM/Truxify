import 'package:flutter/material.dart';
import '../models/freight_heatmap_model.dart';
import '../services/freight_heatmap_service.dart';

class FreightHeatmapScreen extends StatefulWidget {
  const FreightHeatmapScreen({super.key});

  @override
  State<FreightHeatmapScreen> createState() => _FreightHeatmapScreenState();
}

class _FreightHeatmapScreenState extends State<FreightHeatmapScreen> {
  final FreightHeatmapService _service = FreightHeatmapService();
  HeatmapSession? _session;

  @override
  void initState() {
    super.initState();
    _service.heatmapStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.fetchPredictiveData('Dry Van');
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
        title: const Text('Predictive Freight Heatmap'),
        backgroundColor: Colors.blueGrey[900],
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
              _buildFilterCard(s),
              const SizedBox(height: 24),
              const Text('7-DAY PREDICTIVE FORECAST', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.zones.isEmpty)
                const Center(child: CircularProgressIndicator())
              else
                ...s.zones.map((zone) => _buildZoneCard(zone)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(HeatmapSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: Colors.indigo[800],
      child: Column(
        children: [
          const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.map, color: Colors.white, size: 36),
              SizedBox(width: 12),
              Text('MARKET INTELLIGENCE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildFilterCard(HeatmapSession s) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Equipment Type', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text(s.selectedTrailerType, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.blue)),
              ],
            ),
            const Icon(Icons.filter_list, color: Colors.blueGrey),
          ],
        ),
      ),
    );
  }

  Widget _buildZoneCard(HeatmapZone zone) {
    bool isHot = zone.trend == 'Surging';
    bool isCold = zone.trend == 'Crashing';
    
    Color color = isHot ? Colors.red : (isCold ? Colors.blue : Colors.orange);
    IconData icon = isHot ? Icons.trending_up : (isCold ? Icons.trending_down : Icons.trending_flat);

    return Card(
      elevation: isHot ? 4 : 1,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: color, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(icon, color: color),
                    const SizedBox(width: 12),
                    Text(zone.zoneName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(zone.trend.toUpperCase(), style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 12)),
                )
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Current Avg', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text('\$${zone.currentAvgRatePerMile.toStringAsFixed(2)}/mi', style: TextStyle(color: Colors.blueGrey[900], fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                const Icon(Icons.arrow_forward, color: Colors.grey, size: 16),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Predicted (7 Days)', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text('\$${zone.predictedRatePerMile.toStringAsFixed(2)}/mi', style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 24)),
                  ],
                ),
              ],
            )
          ],
        ),
      ),
    );
  }
}
