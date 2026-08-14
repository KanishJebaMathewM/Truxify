import 'package:flutter/material.dart';
import '../models/tanker_cg_model.dart';
import '../services/tanker_cg_service.dart';

class TankerCgScreen extends StatefulWidget {
  const TankerCgScreen({super.key});

  @override
  State<TankerCgScreen> createState() => _TankerCgScreenState();
}

class _TankerCgScreenState extends State<TankerCgScreen> {
  final TankerCgService _service = TankerCgService();
  TankerCgSession? _session;

  @override
  void initState() {
    super.initState();
    _service.cgStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateOffRampCornering();
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
        title: const Text('Tanker Fluid Dynamics'),
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
    
    bool isDanger = s.rolloverThresholdPercent > 70.0;

    return Column(
      children: [
        _buildStatusHeader(s, isDanger),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildCgVisualizer(s, isDanger),
              const SizedBox(height: 24),
              const Text('LOAD TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildFluidCard(s.fluid),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(TankerCgSession s, bool isDanger) {
    Color headerColor;
    IconData icon;
    
    if (isDanger) {
      headerColor = Colors.red[900]!;
      icon = Icons.warning;
    } else {
      headerColor = Colors.green[800]!;
      icon = Icons.balance;
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
              const Text('DYNAMIC CENTER OF GRAVITY', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (isDanger) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildCgVisualizer(TankerCgSession s, bool isDanger) {
    return Card(
      elevation: isDanger ? 8 : 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isDanger ? Colors.red : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Rollover Threshold', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                Text('${s.rolloverThresholdPercent.toInt()}%', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: isDanger ? Colors.red : Colors.green)),
              ],
            ),
            const SizedBox(height: 16),
            LinearProgressIndicator(
              value: s.rolloverThresholdPercent / 100.0,
              backgroundColor: Colors.grey[200],
              color: isDanger ? Colors.red : Colors.green,
              minHeight: 12,
              borderRadius: BorderRadius.circular(6),
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildGForceIndicator('Lateral (Cornering)', s.lateralGForce, isDanger),
                _buildGForceIndicator('Long. (Braking)', s.longitudinalGForce, isDanger),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildGForceIndicator(String label, double value, bool isDanger) {
    return Column(
      children: [
        Text('${value > 0 ? '+' : ''}${value.toStringAsFixed(2)} G', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: isDanger ? Colors.orange : Colors.blueGrey, fontFamily: 'monospace')),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
      ],
    );
  }

  Widget _buildFluidCard(FluidDynamics f) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.water_drop, color: Colors.blue),
                const SizedBox(width: 12),
                Text(f.fluidType, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Volume', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                    Text('${f.volumeGallons.toInt()} GAL', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Slosh Factor', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                    Text('${(f.currentSloshFactor * 100).toInt()}%', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: f.currentSloshFactor > 0.5 ? Colors.red : Colors.blue)),
                  ],
                )
              ],
            )
          ],
        ),
      ),
    );
  }
}
