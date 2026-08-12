import 'package:flutter/material.dart';
import '../models/load_balancing_model.dart';
import '../services/load_balancing_service.dart';

class LoadBalancingScreen extends StatefulWidget {
  const LoadBalancingScreen({super.key});

  @override
  State<LoadBalancingScreen> createState() => _LoadBalancingScreenState();
}

class _LoadBalancingScreenState extends State<LoadBalancingScreen> {
  final LoadBalancingService _service = LoadBalancingService();
  LoadBalancingSession? _session;

  @override
  void initState() {
    super.initState();
    _service.loadStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateLoadingProcess();
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
        title: const Text('AR Load Balancer'),
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
              if (s.activeScannedPallet != null) ...[
                _buildActivePalletCard(s.activeScannedPallet!, s.isArActive),
                const SizedBox(height: 24),
              ],
              const Text('LIVE AXLE DISTRIBUTION', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildAxleRow('Steer Axles', s.currentSteerWeight, 12000),
              const SizedBox(height: 8),
              _buildAxleRow('Drive Axles', s.currentDriveWeight, 34000),
              const SizedBox(height: 8),
              _buildAxleRow('Trailer Tandems', s.currentTandemWeight, 34000),
              const SizedBox(height: 24),
              const Text('MANIFEST LOG', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.loadedPallets.isEmpty)
                const Center(child: Text('Trailer is empty.', style: TextStyle(color: Colors.grey)))
              else
                ...s.loadedPallets.map((p) => _buildManifestItem(p)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(LoadBalancingSession s) {
    Color headerColor = s.isArActive ? Colors.deepPurple[800]! : Colors.blueGrey[800]!;
    IconData icon = s.isArActive ? Icons.view_in_ar : Icons.qr_code_scanner;

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
              const Text('SPATIAL LOADING ASSISTANT', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isArActive) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildActivePalletCard(Pallet p, bool isArActive) {
    return Card(
      elevation: isArActive ? 8 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isArActive ? Colors.deepPurple : Colors.blueGrey, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(p.id, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
                    Text(p.content, style: const TextStyle(color: Colors.grey)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(color: Colors.orange[50], borderRadius: BorderRadius.circular(12)),
                  child: Text('${p.weightLbs.toInt()} lbs', style: TextStyle(color: Colors.orange[900], fontWeight: FontWeight.bold, fontSize: 18)),
                )
              ],
            ),
            const Divider(height: 32),
            if (isArActive) ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: Colors.deepPurple[50], borderRadius: BorderRadius.circular(12)),
                child: Column(
                  children: [
                    Text('TARGET PLACEMENT ZONE:', style: TextStyle(color: Colors.deepPurple[900], fontSize: 12, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.push_pin, color: Colors.deepPurple[900]),
                        const SizedBox(width: 8),
                        Text(p.recommendedZone ?? 'Auto', style: TextStyle(color: Colors.deepPurple[900], fontSize: 24, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ],
                ),
              )
            ] else ...[
              const Center(child: CircularProgressIndicator())
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildAxleRow(String label, double currentLbs, double maxLbs) {
    double progress = currentLbs / maxLbs;
    bool isHeavy = progress > 0.9;

    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(label, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                Text('${currentLbs.toInt()} / ${maxLbs.toInt()} lbs', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: isHeavy ? Colors.orange[900] : Colors.black87)),
              ],
            ),
            const SizedBox(height: 12),
            LinearProgressIndicator(
              value: progress.clamp(0.0, 1.0),
              backgroundColor: Colors.grey[200],
              color: isHeavy ? Colors.orange : Colors.green,
              minHeight: 8,
              borderRadius: BorderRadius.circular(4),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildManifestItem(Pallet p) {
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8), side: BorderSide(color: Colors.grey[300]!)),
      child: ListTile(
        leading: const Icon(Icons.check_circle, color: Colors.green),
        title: Text(p.id, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text('Placed in ${p.recommendedZone}'),
        trailing: Text('${p.weightLbs.toInt()} lbs', style: const TextStyle(fontWeight: FontWeight.bold)),
      ),
    );
  }
}
