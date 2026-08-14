import 'package:flutter/material.dart';
import '../models/ar_loading_model.dart';
import '../services/ar_loading_service.dart';

class ArLoadingScreen extends StatefulWidget {
  const ArLoadingScreen({super.key});

  @override
  State<ArLoadingScreen> createState() => _ArLoadingScreenState();
}

class _ArLoadingScreenState extends State<ArLoadingScreen> {
  final ArLoadingService _service = ArLoadingService();
  ArLoadingSession? _session;

  @override
  void initState() {
    super.initState();
    _service.loadingStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateLoading();
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
        title: const Text('AR Cargo Optimizer'),
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
              _buildAxleWeightDistribution(s),
              const SizedBox(height: 24),
              const Text('ACTIVE AR HOLOGRAM', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.activePallet != null)
                _buildActivePalletCard(s.activePallet!)
              else
                _buildScanningCard(s),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(ArLoadingSession s) {
    bool isProjecting = s.status.contains('Active');
    Color headerColor = isProjecting ? Colors.blueAccent[700]! : Colors.indigo[800]!;
    IconData icon = isProjecting ? Icons.view_in_ar : Icons.radar;

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
              const Text('SPATIAL COMPUTING', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          LinearProgressIndicator(
            value: s.totalPallets > 0 ? (s.placedPallets / s.totalPallets) : 0,
            backgroundColor: Colors.white24,
            color: Colors.white,
            minHeight: 8,
          ),
          const SizedBox(height: 8),
          Text(
            'Pallets Loaded: ${s.placedPallets} / ${s.totalPallets}',
            style: const TextStyle(color: Colors.white70, fontSize: 12)
          ),
        ],
      ),
    );
  }

  Widget _buildAxleWeightDistribution(ArLoadingSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('LIVE AXLE BALANCING', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildAxleGauge('Steer', s.steerAxleLbs, 12000),
                _buildAxleGauge('Drive', s.driveAxleLbs, 34000),
                _buildAxleGauge('Tandem', s.tandemAxleLbs, 34000),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildAxleGauge(String label, double currentWeight, double maxWeight) {
    double pct = currentWeight / maxWeight;
    Color gaugeColor = pct > 0.95 ? Colors.red : Colors.green;

    return Column(
      children: [
        Stack(
          alignment: Alignment.center,
          children: [
            SizedBox(
              width: 80,
              height: 80,
              child: CircularProgressIndicator(
                value: pct,
                backgroundColor: Colors.grey[200],
                color: gaugeColor,
                strokeWidth: 8,
              ),
            ),
            Icon(Icons.tire_repair, color: Colors.blueGrey[800], size: 28),
          ],
        ),
        const SizedBox(height: 12),
        Text(label, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        Text('${(currentWeight / 1000).toStringAsFixed(1)}k / ${(maxWeight / 1000).toStringAsFixed(1)}k', style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }

  Widget _buildScanningCard(ArLoadingSession s) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: const Padding(
        padding: EdgeInsets.all(32),
        child: Column(
          children: [
            CircularProgressIndicator(color: Colors.indigo),
            SizedBox(height: 16),
            Text('Processing Spatial Geometry...', style: TextStyle(color: Colors.grey)),
          ],
        ),
      ),
    );
  }

  Widget _buildActivePalletCard(PalletDirective p) {
    return Card(
      elevation: 8,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Colors.blueAccent[700]!, width: 2),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.blue[50],
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('TARGET PLACEMENT', style: TextStyle(color: Colors.blueAccent, fontWeight: FontWeight.bold, fontSize: 12)),
                      const SizedBox(height: 4),
                      Text(p.placementZone, style: TextStyle(color: Colors.blue[900], fontSize: 24, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
                Icon(Icons.control_camera, color: Colors.blue[800], size: 36),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Pallet ID:', style: TextStyle(fontSize: 16, color: Colors.grey)),
                    Text(p.palletId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, fontFamily: 'monospace')),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Weight:', style: TextStyle(fontSize: 16, color: Colors.grey)),
                    Text('${p.weightLbs} lbs', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.orange[900])),
                  ],
                ),
                const Divider(height: 32),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.blueAccent[700], borderRadius: BorderRadius.circular(8)),
                  child: const Column(
                    children: [
                      Text('GUIDING FORKLIFT', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                      SizedBox(height: 4),
                      Text('Drive towards the glowing AR projection.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white70, fontSize: 14)),
                    ],
                  ),
                )
              ],
            ),
          )
        ],
      ),
    );
  }
}
