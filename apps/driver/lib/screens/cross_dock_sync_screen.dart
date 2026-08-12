import 'package:flutter/material.dart';
import '../models/cross_dock_sync_model.dart';
import '../services/cross_dock_sync_service.dart';

class CrossDockSyncScreen extends StatefulWidget {
  const CrossDockSyncScreen({super.key});

  @override
  State<CrossDockSyncScreen> createState() => _CrossDockSyncScreenState();
}

class _CrossDockSyncScreenState extends State<CrossDockSyncScreen> {
  final CrossDockSyncService _service = CrossDockSyncService();
  CrossDockSession? _session;

  @override
  void initState() {
    super.initState();
    _service.syncStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateNetworkSync();
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
        title: const Text('LTL Network Sync AI'),
        backgroundColor: Colors.indigo[900],
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
              _buildTargetCard(s),
              const SizedBox(height: 24),
              const Text('INBOUND FLEET TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...s.networkTrucks.map((truck) => _buildTruckCard(truck)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(CrossDockSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isSpeedAdjusted) {
      headerColor = Colors.orange[800]!;
      icon = Icons.speed;
    } else if (s.networkTrucks.any((t) => t.isDelayed)) {
      headerColor = Colors.red[800]!;
      icon = Icons.warning;
    } else {
      headerColor = Colors.indigo[800]!;
      icon = Icons.device_hub;
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
              const Text('CROSS-DOCK MESH NETWORK', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isSpeedAdjusted) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(12)),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.arrow_downward, color: Colors.white),
                  const SizedBox(width: 8),
                  Text('NEW TARGET: ${s.recommendedSpeedMph.toInt()} MPH', style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
                ],
              ),
            )
          ]
        ],
      ),
    );
  }

  Widget _buildTargetCard(CrossDockSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Colors.indigo[50],
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.indigo, width: 2),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('TERMINAL DESTINATION', style: TextStyle(color: Colors.indigo, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                const SizedBox(height: 4),
                Text(s.targetTerminal, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                const Text('SYNC ETA', style: TextStyle(color: Colors.indigo, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                const SizedBox(height: 4),
                Text(s.synchronizedEta, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: s.isSpeedAdjusted ? Colors.orange[800] : Colors.indigo[900])),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTruckCard(InboundTruck t) {
    bool isMe = t.truckId.contains('You');
    Color cardColor = isMe ? Colors.blue[50]! : Colors.white;
    Color statusColor = t.isDelayed ? Colors.red : Colors.green;

    return Card(
      color: cardColor,
      margin: const EdgeInsets.only(bottom: 12),
      elevation: isMe ? 2 : 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isMe ? Colors.blue : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t.truckId, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: isMe ? Colors.blue[900] : Colors.black87)),
                Text('From: ${t.origin}', style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Row(
                  children: [
                    Icon(Icons.speed, size: 16, color: Colors.grey[600]),
                    const SizedBox(width: 4),
                    Text('${t.currentSpeedMph.toInt()} mph', style: const TextStyle(fontWeight: FontWeight.bold)),
                  ],
                ),
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(color: statusColor.withOpacity(0.1), borderRadius: BorderRadius.circular(4)),
                  child: Text('ETA: ${t.eta}', style: TextStyle(color: statusColor, fontWeight: FontWeight.bold, fontSize: 12)),
                )
              ],
            )
          ],
        ),
      ),
    );
  }
}
