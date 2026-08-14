import 'package:flutter/material.dart';
import '../models/trailer_repositioning_model.dart';
import '../services/trailer_repositioning_service.dart';

class TrailerRepositioningScreen extends StatefulWidget {
  const TrailerRepositioningScreen({super.key});

  @override
  State<TrailerRepositioningScreen> createState() => _TrailerRepositioningScreenState();
}

class _TrailerRepositioningScreenState extends State<TrailerRepositioningScreen> {
  final TrailerRepositioningService _service = TrailerRepositioningService();
  TrailerRepositioningSession? _session;

  @override
  void initState() {
    super.initState();
    _service.optimizationStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeDashboard();
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
        title: const Text('Equipment Optimization Engine'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isAnalyzing == true ? null : () => _service.runOptimizationAlgorithm(),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.hub),
        label: const Text('Run Repositioning Algorithm'),
      ),
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
              if (s.zoneAnalytics.isNotEmpty) ...[
                const Text('MACRO ZONE ANALYTICS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                ...s.zoneAnalytics.map((z) => _buildZoneCard(z)),
                const SizedBox(height: 24),
                const Text('SUGGESTED REPOSITIONING ACTIONS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                ...s.suggestedActions.map((a) => _buildActionCard(a)),
              ] else ...[
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('Tap Run Algorithm to optimize fleet equipment.', style: TextStyle(color: Colors.grey)),
                ))
              ],
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(TrailerRepositioningSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isAnalyzing ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isAnalyzing 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.rv_hookup, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('SUPPLY-CHAIN OPTIMIZER', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildZoneCard(ZoneDemand zone) {
    Color statusColor = Colors.grey;
    IconData icon = Icons.check_circle;
    
    if (zone.status == 'Surplus') {
      statusColor = Colors.blue;
      icon = Icons.add_circle;
    } else if (zone.status == 'Deficit') {
      statusColor = Colors.red;
      icon = Icons.warning;
    } else {
      statusColor = Colors.green;
    }

    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(zone.locationName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                Chip(
                  label: Text(zone.status.toUpperCase(), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 10)),
                  backgroundColor: statusColor,
                  visualDensity: VisualDensity.compact,
                )
              ],
            ),
            const Divider(),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('Empty Trailers', zone.emptyTrailersAvailable.toString(), Colors.blueGrey),
                _buildMetric('Projected Loads', zone.projectedFreightVolume.toString(), Colors.indigo),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: color)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }

  Widget _buildActionCard(RepositioningAction action) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Colors.indigo, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              children: [
                const Icon(Icons.route, color: Colors.indigo),
                const SizedBox(width: 12),
                Expanded(child: Text('${action.originZone} ➔ ${action.destinationZone}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18))),
              ],
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
              decoration: BoxDecoration(color: Colors.indigo[50], borderRadius: BorderRadius.circular(8)),
              child: Text('ACTION: Dispatch ${action.trailersToMove} "Deadhead" Trailers', style: const TextStyle(color: Colors.indigo, fontWeight: FontWeight.bold)),
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Est. Cost to Move', style: TextStyle(color: Colors.red, fontSize: 12, fontWeight: FontWeight.bold)),
                    Text('\$${action.estimatedCost.toStringAsFixed(0)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.red)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Revenue Saved', style: TextStyle(color: Colors.green, fontSize: 12, fontWeight: FontWeight.bold)),
                    Text('\$${action.projectedRevenueSaved.toStringAsFixed(0)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.green)),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () {},
                icon: const Icon(Icons.assignment),
                label: const Text('Execute Repositioning Orders'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.indigo,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.all(16),
                ),
              ),
            )
          ],
        ),
      ),
    );
  }
}
