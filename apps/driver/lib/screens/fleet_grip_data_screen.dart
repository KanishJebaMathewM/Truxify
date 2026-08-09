import 'package:flutter/material.dart';
import '../models/fleet_grip_data_model.dart';
import '../services/fleet_grip_data_service.dart';

class FleetGripDataScreen extends StatefulWidget {
  const FleetGripDataScreen({super.key});

  @override
  State<FleetGripDataScreen> createState() => _FleetGripDataScreenState();
}

class _FleetGripDataScreenState extends State<FleetGripDataScreen> {
  final FleetGripDataService _service = FleetGripDataService();
  FleetGripNetwork? _network;

  @override
  void initState() {
    super.initState();
    _service.meshStream.listen((data) {
      if (mounted) setState(() => _network = data);
    });
    _service.simulateGripMesh();
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
        title: const Text('Crowdsourced Grip Mesh'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _network == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final n = _network!;
    
    return Column(
      children: [
        _buildGripHeader(n),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text('CROWDSOURCED CONDITIONS AHEAD', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...n.upcomingReports.map((report) => _buildReportCard(report)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildGripHeader(FleetGripNetwork n) {
    Color headerColor = Colors.green[700]!;
    if (n.currentGripIndex < 8.0) headerColor = Colors.orange[700]!;
    if (n.requiresChains || n.currentGripIndex < 4.0) headerColor = Colors.red[900]!;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 500),
      width: double.infinity,
      padding: const EdgeInsets.all(32),
      color: headerColor,
      child: Column(
        children: [
          Icon(Icons.ac_unit, color: Colors.white, size: 48),
          const SizedBox(height: 16),
          const Text('CURRENT ROAD GRIP INDEX', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, letterSpacing: 2)),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(n.currentGripIndex.toStringAsFixed(1), style: const TextStyle(color: Colors.white, fontSize: 64, fontWeight: FontWeight.bold)),
              const Text(' / 10', style: TextStyle(color: Colors.white54, fontSize: 24, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 16),
          if (n.requiresChains)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(30)),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.link, color: Colors.white),
                  SizedBox(width: 8),
                  Text('CHAIN UP IMMEDIATELY', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
                ],
              ),
            )
          else
            Text(n.currentStatus.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildReportCard(GripReport r) {
    bool isDanger = r.roadGripIndex < 4.0;
    
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: isDanger ? const BorderSide(color: Colors.redAccent, width: 2) : BorderSide.none,
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${r.distanceAheadMiles} MI AHEAD', style: TextStyle(color: isDanger ? Colors.redAccent : Colors.blueGrey, fontWeight: FontWeight.bold, fontSize: 16)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: isDanger ? Colors.red[50] : Colors.green[50], borderRadius: BorderRadius.circular(8)),
                  child: Text('Grip: ${r.roadGripIndex.toStringAsFixed(1)}', style: TextStyle(color: isDanger ? Colors.red : Colors.green, fontWeight: FontWeight.bold)),
                )
              ],
            ),
            const SizedBox(height: 8),
            Text(r.highwaySegment, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Text(r.status, style: TextStyle(color: isDanger ? Colors.red : Colors.grey[800], fontWeight: isDanger ? FontWeight.bold : FontWeight.normal)),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('Slip/ABS Events', '${r.activeSlipEventsDetected}', Icons.warning, color: isDanger ? Colors.red : Colors.orange),
                _buildMetric('Reporting Trucks', '${r.reportingTrucks}', Icons.local_shipping, color: Colors.blue),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, IconData icon, {required Color color}) {
    return Column(
      children: [
        Icon(icon, color: color, size: 24),
        const SizedBox(height: 8),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
