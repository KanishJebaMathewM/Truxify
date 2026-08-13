import 'package:flutter/material.dart';
import '../models/aero_tail_model.dart';
import '../services/aero_tail_service.dart';

class AeroTailScreen extends StatefulWidget {
  const AeroTailScreen({super.key});

  @override
  State<AeroTailScreen> createState() => _AeroTailScreenState();
}

class _AeroTailScreenState extends State<AeroTailScreen> {
  final AeroTailService _service = AeroTailService();
  AeroTailSession? _session;

  @override
  void initState() {
    super.initState();
    _service.tailStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateHighwayEntry();
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
        title: const Text('Dynamic Aero-Tails'),
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
    
    bool isDeployed = s.foils.any((f) => f.actuatorPositionPercent == 100.0);
    bool isActuating = s.foils.any((f) => f.status == 'Actuating');

    return Column(
      children: [
        _buildStatusHeader(s, isDeployed, isActuating),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildTelemetryGrid(s),
              const SizedBox(height: 24),
              const Text('REAR FOIL ACTUATORS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...s.foils.map((f) => _buildFoilCard(f)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(AeroTailSession s, bool isDeployed, bool isActuating) {
    Color headerColor;
    IconData icon;
    
    if (isActuating) {
      headerColor = Colors.orange[800]!;
      icon = Icons.sync;
    } else if (isDeployed) {
      headerColor = Colors.green[800]!;
      icon = Icons.air;
    } else {
      headerColor = Colors.blueGrey[800]!;
      icon = Icons.compress;
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
              const Text('ACTIVE AERODYNAMICS', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (isActuating) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildTelemetryGrid(AeroTailSession s) {
    return Row(
      children: [
        Expanded(
          child: _buildMetricTile(
            'Vehicle Speed', 
            '${s.vehicleSpeedMph.toInt()} MPH', 
            Icons.speed, 
            s.vehicleSpeedMph > 50 ? Colors.green : Colors.blueGrey,
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: _buildMetricTile(
            'Drag Reduction', 
            '-${s.dragReductionPercent.toStringAsFixed(1)}%', 
            Icons.eco, 
            s.dragReductionPercent > 5.0 ? Colors.green : Colors.blueGrey,
          ),
        ),
      ],
    );
  }

  Widget _buildMetricTile(String label, String value, IconData icon, Color color) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: color.withOpacity(0.3), width: 2)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Icon(icon, color: color, size: 32),
            const SizedBox(height: 12),
            Text(value, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 24)),
            const SizedBox(height: 4),
            Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
  }

  Widget _buildFoilCard(MotorizedFoil f) {
    bool isDeployed = f.actuatorPositionPercent == 100.0;
    
    return Card(
      elevation: isDeployed ? 4 : 1,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isDeployed ? Colors.green : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(isDeployed ? Icons.expand_more : Icons.expand_less, color: isDeployed ? Colors.green : Colors.blueGrey),
                    const SizedBox(width: 12),
                    Text(f.location, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                Text(isDeployed ? 'DEPLOYED' : 'FOLDED', style: TextStyle(color: isDeployed ? Colors.green : Colors.grey, fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 12),
            LinearProgressIndicator(
              value: f.actuatorPositionPercent / 100.0,
              backgroundColor: Colors.grey[200],
              color: isDeployed ? Colors.green : (f.status == 'Actuating' ? Colors.orange : Colors.blueGrey),
              minHeight: 8,
              borderRadius: BorderRadius.circular(4),
            ),
          ],
        ),
      ),
    );
  }
}
