import 'package:flutter/material.dart';
import '../models/hazard_mesh_model.dart';
import '../services/hazard_mesh_service.dart';

class HazardMeshScreen extends StatefulWidget {
  const HazardMeshScreen({super.key});

  @override
  State<HazardMeshScreen> createState() => _HazardMeshScreenState();
}

class _HazardMeshScreenState extends State<HazardMeshScreen> {
  final HazardMeshService _service = HazardMeshService();
  HazardMeshSession? _session;

  @override
  void initState() {
    super.initState();
    _service.meshStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateHazardApproach();
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
        title: const Text('Road Hazard Mesh'),
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
              _buildMeshCard(s),
              const SizedBox(height: 24),
              const Text('CROWDSOURCED HAZARDS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.upcomingHazards.isEmpty)
                const Card(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: Text('Road Clear', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold))),
                  ),
                )
              else
                ...s.upcomingHazards.map((h) => _buildHazardCard(h)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(HazardMeshSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isHazardActive) {
      headerColor = Colors.orange[800]!;
      icon = Icons.warning_amber_rounded;
    } else {
      headerColor = Colors.green[800]!;
      icon = Icons.radar;
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
              const Text('P2P SUSPENSION TELEMETRY', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isHazardActive) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildMeshCard(HazardMeshSession s) {
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
                const Text('Active Mesh Nodes', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text('${s.activeNodesInMesh} Trucks Nearby', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.blue)),
              ],
            ),
            const Icon(Icons.share, color: Colors.blueGrey),
          ],
        ),
      ),
    );
  }

  Widget _buildHazardCard(RoadHazard h) {
    bool isCritical = h.severity.contains('Risk');

    return Card(
      elevation: 4,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isCritical ? Colors.orange : Colors.transparent, width: 2),
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
                    Icon(Icons.report_problem, color: isCritical ? Colors.orange : Colors.blueGrey),
                    const SizedBox(width: 12),
                    Text(h.type, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                Text('${h.distanceAheadMiles.toStringAsFixed(1)} MI AHEAD', style: TextStyle(color: isCritical ? Colors.red : Colors.grey, fontWeight: FontWeight.bold, fontSize: 14)),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Location', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text(h.lane, style: TextStyle(color: Colors.blueGrey[900], fontWeight: FontWeight.bold, fontSize: 18)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Recorded Impact', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text('${h.impactGForce.toStringAsFixed(1)} G', style: TextStyle(color: Colors.orange[800], fontFamily: 'monospace', fontWeight: FontWeight.bold, fontSize: 18)),
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
