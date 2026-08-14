import 'package:flutter/material.dart';
import '../models/tire_chain_model.dart';
import '../services/tire_chain_service.dart';

class TireChainScreen extends StatefulWidget {
  const TireChainScreen({super.key});

  @override
  State<TireChainScreen> createState() => _TireChainScreenState();
}

class _TireChainScreenState extends State<TireChainScreen> {
  final TireChainService _service = TireChainService();
  TireChainSession? _session;

  @override
  void initState() {
    super.initState();
    _service.chainStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateBlizzardDeployment();
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
        title: const Text('Auto-Chain AI Deployment'),
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
              _buildTelemetryGrid(s),
              const SizedBox(height: 24),
              const Text('PNEUMATIC SYSTEM STATUS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildChainSystemCard(s.chainSystem),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(TireChainSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.chainSystem.isDeployed) {
      headerColor = Colors.green[800]!;
      icon = Icons.link;
    } else if (s.isHazardActive) {
      headerColor = Colors.red[900]!;
      icon = Icons.warning;
    } else {
      headerColor = Colors.blue[900]!;
      icon = Icons.ac_unit;
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
              const Text('WINTER TRACTION AI', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isHazardActive && !s.chainSystem.isDeployed) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildTelemetryGrid(TireChainSession s) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 1.5,
      children: [
        _buildMetricTile('Wheel Slip', '${s.wheelSlipPercentage.toStringAsFixed(1)}%', Icons.car_crash, s.wheelSlipPercentage > 10 ? Colors.red : Colors.blueGrey),
        _buildMetricTile('Road Grade', '${s.roadGrade.toStringAsFixed(1)}%', Icons.terrain, s.roadGrade > 5 ? Colors.orange : Colors.blueGrey),
        _buildMetricTile('Speed', '${s.vehicleSpeedMph.toInt()} MPH', Icons.speed, s.chainSystem.isDeployed && s.vehicleSpeedMph > 25 ? Colors.red : Colors.blueGrey),
        _buildMetricTile('Ambient Temp', '${s.ambientTempF.toInt()}°F', Icons.thermostat, s.ambientTempF < 32 ? Colors.blue : Colors.blueGrey),
      ],
    );
  }

  Widget _buildMetricTile(String label, String value, IconData icon, Color color) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: color.withOpacity(0.3), width: 2)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: color, size: 28),
            const SizedBox(height: 8),
            Text(value, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 20)),
            const SizedBox(height: 4),
            Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
  }

  Widget _buildChainSystemCard(PneumaticChainSystem sys) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: sys.isDeployed ? Colors.green : Colors.grey, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(Icons.settings, color: sys.isDeployed ? Colors.green : Colors.grey, size: 32),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('AUTO-CHAINS', style: TextStyle(color: sys.isDeployed ? Colors.green[900] : Colors.blueGrey, fontWeight: FontWeight.bold, fontSize: 14)),
                        Text(sys.isDeployed ? 'DEPLOYED' : 'RETRACTED', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: sys.isDeployed ? Colors.green : Colors.grey)),
                      ],
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(color: sys.isDeployed ? Colors.green[50] : Colors.grey[100], borderRadius: BorderRadius.circular(12)),
                  child: Text('${sys.currentRpm.toInt()} RPM', style: TextStyle(color: sys.isDeployed ? Colors.green[900] : Colors.grey, fontWeight: FontWeight.bold, fontSize: 18)),
                )
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Pneumatic Air Pressure', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.blueGrey)),
                Text('${sys.airPressurePsi.toInt()} PSI', style: TextStyle(fontWeight: FontWeight.bold, color: sys.airPressurePsi > 90 ? Colors.green : Colors.red)),
              ],
            )
          ],
        ),
      ),
    );
  }
}
