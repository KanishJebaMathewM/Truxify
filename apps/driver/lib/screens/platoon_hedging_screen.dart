import 'package:flutter/material.dart';
import '../models/platoon_hedging_model.dart';
import '../services/platoon_hedging_service.dart';

class PlatoonHedgingScreen extends StatefulWidget {
  const PlatoonHedgingScreen({super.key});

  @override
  State<PlatoonHedgingScreen> createState() => _PlatoonHedgingScreenState();
}

class _PlatoonHedgingScreenState extends State<PlatoonHedgingScreen> {
  final PlatoonHedgingService _service = PlatoonHedgingService();
  PlatoonHedgingSession? _session;

  @override
  void initState() {
    super.initState();
    _service.hedgingStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulatePlatoonSession();
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
        title: const Text('Platoon Fuel Hedging'),
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
              if (s.isPlatooning) ...[
                _buildEarningsCard(s.myNetEarningsUsd),
                const SizedBox(height: 24),
              ],
              const Text('DECENTRALIZED PLATOON NETWORK', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.members.isEmpty)
                const Center(child: Text('Scanning for independent trucks...', style: TextStyle(color: Colors.grey)))
              else
                ...s.members.map((m) => _buildMemberCard(m)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(PlatoonHedgingSession s) {
    Color headerColor = s.isPlatooning ? Colors.deepPurple[800]! : Colors.blueGrey[800]!;
    IconData icon = s.isPlatooning ? Icons.link : Icons.wifi_tethering;

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
              const Text('FINANCIAL FUEL HEDGING', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.smartContractAddress != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(8)),
              child: Text('CONTRACT: ${s.smartContractAddress}', style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold, fontFamily: 'monospace')),
            )
          ] else ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildEarningsCard(double earnings) {
    bool isReceiving = earnings >= 0;
    
    return Card(
      elevation: 8,
      color: isReceiving ? Colors.green[900] : Colors.orange[900],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Text(isReceiving ? 'NET PROFIT (WINDBREAKING)' : 'NET COST (DRAFTING)', style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(isReceiving ? Icons.arrow_upward : Icons.arrow_downward, color: Colors.white, size: 36),
                const SizedBox(width: 8),
                Text('\$${earnings.abs().toStringAsFixed(2)}', style: const TextStyle(color: Colors.white, fontSize: 48, fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 8),
            const Text('LIVE MICRO-TRANSACTION STREAM', style: TextStyle(color: Colors.white54, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  Widget _buildMemberCard(PlatoonMember m) {
    bool isMe = m.truckId.contains('MY-TRUCK');
    bool isLeader = m.role == 'Windbreaker';

    return Card(
      elevation: isMe ? 4 : 1,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isMe ? Colors.deepPurple : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(isLeader ? Icons.air : Icons.compress, color: isLeader ? Colors.deepPurple : Colors.grey),
                    const SizedBox(width: 8),
                    Text(m.truckId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                const SizedBox(height: 4),
                Text('${m.role} • ${m.distanceFeet.toInt()} ft', style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('${m.aerodynamicSavingsPercent > 0 ? '+' : ''}${m.aerodynamicSavingsPercent.toStringAsFixed(1)}% MPG', style: TextStyle(fontWeight: FontWeight.bold, color: m.aerodynamicSavingsPercent > 0 ? Colors.green : Colors.red)),
                const SizedBox(height: 4),
                Text(m.activeStreamUsd >= 0 ? '+\$${m.activeStreamUsd.toStringAsFixed(2)}' : '-\$${m.activeStreamUsd.abs().toStringAsFixed(2)}', style: const TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold, fontFamily: 'monospace')),
              ],
            )
          ],
        ),
      ),
    );
  }
}
