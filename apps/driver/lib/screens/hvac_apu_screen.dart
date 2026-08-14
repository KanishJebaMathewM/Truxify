import 'package:flutter/material.dart';
import '../models/hvac_apu_model.dart';
import '../services/hvac_apu_service.dart';

class HvacApuScreen extends StatefulWidget {
  const HvacApuScreen({super.key});

  @override
  State<HvacApuScreen> createState() => _HvacApuScreenState();
}

class _HvacApuScreenState extends State<HvacApuScreen> {
  final HvacApuService _service = HvacApuService();
  HvacApuSession? _session;

  @override
  void initState() {
    super.initState();
    _service.hvacStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateWakeCycle();
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
        title: const Text('Smart APU Pre-conditioning'),
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
              _buildTemperatureCard(s),
              const SizedBox(height: 24),
              const Text('ELECTRIC APU TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildApuCard(s.apu),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(HvacApuSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.apu.activeMode == 'Heating') {
      headerColor = Colors.orange[800]!;
      icon = Icons.local_fire_department;
    } else if (s.apu.activeMode == 'Cooling') {
      headerColor = Colors.blue[800]!;
      icon = Icons.ac_unit;
    } else if (s.apu.activeMode == 'Maintaining') {
      headerColor = Colors.green[800]!;
      icon = Icons.check_circle;
    } else {
      headerColor = Colors.blueGrey[800]!;
      icon = Icons.bedtime;
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
              const Text('HVAC SCHEDULER', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.apu.activeMode == 'Heating' || s.apu.activeMode == 'Cooling') ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildTemperatureCard(HvacApuSession s) {
    bool isHeating = s.apu.activeMode == 'Heating';
    
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
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
                    const Text('Current Cab Temp', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('${s.currentCabTempF.toInt()}°', style: TextStyle(fontSize: 48, fontWeight: FontWeight.bold, color: isHeating ? Colors.orange : Colors.blueGrey)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Target Wake Temp', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('${s.targetCabTempF.toInt()}°', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.grey)),
                  ],
                ),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.cloud, color: Colors.grey, size: 20),
                    const SizedBox(width: 8),
                    Text('Ambient: ${s.ambientTempF.toInt()}°F', style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                  ],
                ),
                Row(
                  children: [
                    const Icon(Icons.alarm, color: Colors.indigo, size: 20),
                    const SizedBox(width: 8),
                    Text('Wake: ${s.estimatedWakeTime.hour}:${s.estimatedWakeTime.minute.toString().padLeft(2, '0')}', style: const TextStyle(color: Colors.indigo, fontWeight: FontWeight.bold)),
                  ],
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildApuCard(ApuSystem apu) {
    return Card(
      elevation: apu.isRunning ? 4 : 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: apu.isRunning ? Colors.green : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(apu.isRunning ? Icons.bolt : Icons.power_off, color: apu.isRunning ? Colors.green : Colors.grey),
                    const SizedBox(width: 8),
                    Text(apu.isRunning ? 'APU ONLINE' : 'APU IDLE', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: apu.isRunning ? Colors.green[900] : Colors.grey)),
                  ],
                ),
                const SizedBox(height: 8),
                Text('Power Draw: ${apu.currentDrawKw.toStringAsFixed(1)} kW', style: const TextStyle(color: Colors.blueGrey, fontFamily: 'monospace', fontWeight: FontWeight.bold)),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                const Text('Battery SOC', style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
                Text('${apu.batterySoc.toStringAsFixed(1)}%', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: apu.batterySoc > 50 ? Colors.green : Colors.orange)),
              ],
            )
          ],
        ),
      ),
    );
  }
}
