import 'package:flutter/material.dart';
import '../models/livestock_routing_model.dart';
import '../services/livestock_routing_service.dart';

class LivestockRoutingScreen extends StatefulWidget {
  const LivestockRoutingScreen({super.key});

  @override
  State<LivestockRoutingScreen> createState() => _LivestockRoutingScreenState();
}

class _LivestockRoutingScreenState extends State<LivestockRoutingScreen> {
  final LivestockRoutingService _service = LivestockRoutingService();
  LivestockTelemetry? _telemetry;

  @override
  void initState() {
    super.initState();
    _service.routingStream.listen((data) {
      if (mounted) setState(() => _telemetry = data);
    });
    _service.simulateHeatStressReroute();
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
        title: const Text('Livestock Routing Engine'),
        backgroundColor: Colors.brown[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _telemetry == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final t = _telemetry!;
    
    return Column(
      children: [
        _buildThiHeader(t),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildCargoSummary(t),
              const SizedBox(height: 24),
              const Text('ACTIVE ROUTE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
              const SizedBox(height: 8),
              ...t.activeRoute.map((segment) => _buildRouteSegment(segment, t.isAirflowCritical)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildThiHeader(LivestockTelemetry t) {
    bool isDanger = t.currentThi >= t.criticalThi || t.isAirflowCritical;
    Color headerColor = isDanger ? Colors.red[800]! : Colors.green[700]!;

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
              Icon(Icons.thermostat, color: Colors.white, size: 36),
              const SizedBox(width: 8),
              Text('THI: ${t.currentThi.toStringAsFixed(1)}', style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 8),
          Text(isDanger ? 'CRITICAL HEAT STRESS RISK' : 'LIVESTOCK SECURE', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
          if (isDanger) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(8)),
              child: const Text('AIRFLOW CRITICAL. REROUTING AHEAD.', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            )
          ]
        ],
      ),
    );
  }

  Widget _buildCargoSummary(LivestockTelemetry t) {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            Column(
              children: [
                Icon(Icons.pets, color: Colors.brown[700], size: 32),
                const SizedBox(height: 8),
                Text(t.livestockType, style: const TextStyle(fontWeight: FontWeight.bold)),
                const Text('Cargo', style: TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            Column(
              children: [
                Icon(Icons.tag, color: Colors.brown[700], size: 32),
                const SizedBox(height: 8),
                Text('${t.headCount} Head', style: const TextStyle(fontWeight: FontWeight.bold)),
                const Text('Count', style: TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            Column(
              children: [
                Icon(Icons.warning_amber_rounded, color: Colors.orange[700], size: 32),
                const SizedBox(height: 8),
                Text('THI > ${t.criticalThi}', style: const TextStyle(fontWeight: FontWeight.bold)),
                const Text('Danger Limit', style: TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildRouteSegment(LivestockRouteSegment segment, bool isDangerContext) {
    bool isCongested = segment.expectedSpeedMph < 45.0;
    
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: isCongested ? const BorderSide(color: Colors.red, width: 2) : BorderSide.none,
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(segment.highwayName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                if (isCongested) 
                  const Icon(Icons.traffic, color: Colors.red)
                else
                  const Icon(Icons.air, color: Colors.blue)
              ],
            ),
            const SizedBox(height: 4),
            Text(segment.status, style: TextStyle(color: isCongested ? Colors.red : Colors.grey[700], fontWeight: isCongested ? FontWeight.bold : FontWeight.normal)),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildSegmentMetric('Temp', '${segment.ambientTempF.toInt()}°F', Icons.wb_sunny, color: isDangerContext ? Colors.red : Colors.orange),
                _buildSegmentMetric('Humidity', '${segment.humidityPct.toInt()}%', Icons.water_drop, color: Colors.blue),
                _buildSegmentMetric('Speed', '${segment.expectedSpeedMph.toInt()} MPH', Icons.speed, color: isCongested ? Colors.red : Colors.green),
              ],
            )
          ],
        ),
      ),
    );
  }
  
  Widget _buildSegmentMetric(String label, String value, IconData icon, {required Color color}) {
    return Column(
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
