import 'package:flutter/material.dart';
import '../models/ghost_freight_model.dart';
import '../services/ghost_freight_service.dart';

class GhostFreightScreen extends StatefulWidget {
  const GhostFreightScreen({super.key});

  @override
  State<GhostFreightScreen> createState() => _GhostFreightScreenState();
}

class _GhostFreightScreenState extends State<GhostFreightScreen> {
  final GhostFreightService _service = GhostFreightService();
  GhostFreightSession? _session;

  @override
  void initState() {
    super.initState();
    _service.scanningStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeScanner();
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
        title: const Text('Ghost Freight Detector'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isScanning == true ? null : () => _service.scanLoadBoardData(),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.search),
        label: const Text('Scan Load Board API'),
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
              if (s.analyzedLoads.isNotEmpty) ...[
                const Text('LOAD BOARD FEED', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                ...s.analyzedLoads.map((load) => _buildLoadCard(load)),
              ] else ...[
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('Tap Scan to analyze broker API postings.', style: TextStyle(color: Colors.grey)),
                ))
              ],
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(GhostFreightSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isScanning ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isScanning 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.shield, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('HEURISTIC ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildLoadCard(LoadPosting load) {
    Color badgeColor = Colors.green;
    IconData icon = Icons.check_circle;
    
    if (load.statusFlag == 'High Risk Ghost') {
      badgeColor = Colors.red;
      icon = Icons.warning;
    } else if (load.statusFlag == 'Suspicious') {
      badgeColor = Colors.orange;
      icon = Icons.remove_circle;
    }

    return Card(
      elevation: 2,
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: badgeColor, width: 2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text('${load.origin} ➔ ${load.destination}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                ),
                Text('\$${load.rate.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: Colors.indigo)),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.business, size: 16, color: Colors.grey),
                const SizedBox(width: 8),
                Text(load.brokerName, style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('Refreshes', '${load.refreshCount}x', load.refreshCount > 50 ? Colors.red : Colors.blueGrey),
                _buildMetric('Age', '${load.minutesActive} min', load.minutesActive > 180 ? Colors.red : Colors.blueGrey),
                _buildMetric('B&S Rate', '${(load.brokerBaitSwitchRate * 100).toStringAsFixed(0)}%', load.brokerBaitSwitchRate > 0.5 ? Colors.red : Colors.blueGrey),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: badgeColor.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
              child: Row(
                children: [
                  Icon(icon, color: badgeColor),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      load.statusFlag.toUpperCase(),
                      style: TextStyle(color: badgeColor, fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                  ),
                  Text('${load.ghostProbabilityScore.toStringAsFixed(1)}%', style: TextStyle(color: badgeColor, fontWeight: FontWeight.bold, fontSize: 16)),
                ],
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: color)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 10)),
      ],
    );
  }
}
