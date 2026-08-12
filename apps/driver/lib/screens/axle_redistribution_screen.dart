import 'package:flutter/material.dart';
import '../models/axle_redistribution_model.dart';
import '../services/axle_redistribution_service.dart';

class AxleRedistributionScreen extends StatefulWidget {
  const AxleRedistributionScreen({super.key});

  @override
  State<AxleRedistributionScreen> createState() => _AxleRedistributionScreenState();
}

class _AxleRedistributionScreenState extends State<AxleRedistributionScreen> {
  final AxleRedistributionService _service = AxleRedistributionService();
  RedistributionSession? _session;

  @override
  void initState() {
    super.initState();
    _service.redistributionStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateAirSuspensionAdjustment();
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
        title: const Text('Digital Axle Balancer'),
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
              _buildTruckVisualization(s),
              const SizedBox(height: 24),
              const Text('AXLE WEIGHT SCALES', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildAxleRow('Steer Axles', s.currentWeights.steerLbs, 12000),
              const SizedBox(height: 8),
              _buildAxleRow('Drive Axles', s.currentWeights.driveLbs, 34000),
              const SizedBox(height: 8),
              _buildAxleRow('Trailer Tandems', s.currentWeights.tandemLbs, 34000),
              const SizedBox(height: 24),
              _buildTotalWeightCard(s.currentWeights.total),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(RedistributionSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isAdjusting) {
      headerColor = Colors.orange[800]!;
      icon = Icons.sync;
    } else if (s.currentWeights.isLegal) {
      headerColor = Colors.green[800]!;
      icon = Icons.balance;
    } else {
      headerColor = Colors.red[800]!;
      icon = Icons.warning;
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
              const Text('PNEUMATIC SUSPENSION AI', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isAdjusting) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildTruckVisualization(RedistributionSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Icon(Icons.local_shipping, size: 80, color: Colors.blueGrey),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildSuspensionPill('Steer', s.currentWeights.steerLbs, 12000),
                _buildSuspensionPill('Drive', s.currentWeights.driveLbs, 34000),
                _buildSuspensionPill('Tandem', s.currentWeights.tandemLbs, 34000),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildSuspensionPill(String label, double current, double max) {
    bool isOver = current > max;
    return Column(
      children: [
        Text(label, style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: isOver ? Colors.red[50] : Colors.green[50],
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: isOver ? Colors.red : Colors.green),
          ),
          child: Text(isOver ? 'OVER' : 'OK', style: TextStyle(color: isOver ? Colors.red : Colors.green, fontWeight: FontWeight.bold)),
        ),
      ],
    );
  }

  Widget _buildAxleRow(String label, double currentLbs, double maxLbs) {
    bool isOver = currentLbs > maxLbs;
    double progress = currentLbs / maxLbs;

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
                Text('${currentLbs.toInt()} / ${maxLbs.toInt()} lbs', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: isOver ? Colors.red : Colors.black87)),
              ],
            ),
            const SizedBox(height: 12),
            LinearProgressIndicator(
              value: progress.clamp(0.0, 1.0),
              backgroundColor: Colors.grey[300],
              color: isOver ? Colors.red : Colors.green,
              minHeight: 8,
              borderRadius: BorderRadius.circular(4),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTotalWeightCard(double totalLbs) {
    return Card(
      color: Colors.black,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('GROSS WEIGHT', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            Text('${totalLbs.toInt()} lbs', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 24)),
          ],
        ),
      ),
    );
  }
}
