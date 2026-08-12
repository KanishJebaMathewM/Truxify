import 'package:flutter/material.dart';
import '../models/oil_viscosity_model.dart';
import '../services/oil_viscosity_service.dart';

class OilViscosityScreen extends StatefulWidget {
  const OilViscosityScreen({super.key});

  @override
  State<OilViscosityScreen> createState() => _OilViscosityScreenState();
}

class _OilViscosityScreenState extends State<OilViscosityScreen> {
  final OilViscosityService _service = OilViscosityService();
  OilSession? _session;

  @override
  void initState() {
    super.initState();
    _service.fluidStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateHeavyHauling();
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
        title: const Text('In-Engine Fluid AI'),
        backgroundColor: Colors.brown[900],
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
              _buildIntervalCard(s),
              const SizedBox(height: 24),
              const Text('LAB-GRADE TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildTelemetryGrid(s.telemetry, s.isServiceRequired),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(OilSession s) {
    Color headerColor = s.isServiceRequired ? Colors.red[900]! : Colors.brown[800]!;
    IconData icon = s.isServiceRequired ? Icons.warning : Icons.oil_barrel;

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
              const Text('LUBRICITY MONITOR', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (!s.isServiceRequired) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildIntervalCard(OilSession s) {
    double progress = s.currentMilesSinceChange / 50000; // Assuming 50k is max hard cap
    
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: s.isServiceRequired ? Colors.red[50] : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: s.isServiceRequired ? Colors.red : Colors.transparent, width: 2),
        ),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('CURRENT MILEAGE', style: TextStyle(color: Colors.grey[700], fontWeight: FontWeight.bold, fontSize: 12)),
                    Text('${s.currentMilesSinceChange}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 24)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(s.isServiceRequired ? 'SERVICE NOW' : 'AI TARGET INTERVAL', style: TextStyle(color: s.isServiceRequired ? Colors.red : Colors.brown, fontWeight: FontWeight.bold, fontSize: 12)),
                    Text('${s.recommendedServiceMiles}', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: s.isServiceRequired ? Colors.red[900] : Colors.brown[900])),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 16),
            LinearProgressIndicator(
              value: progress.clamp(0.0, 1.0),
              backgroundColor: Colors.grey[200],
              color: s.isServiceRequired ? Colors.red : Colors.brown,
              minHeight: 12,
              borderRadius: BorderRadius.circular(6),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTelemetryGrid(FluidAnalysis t, bool isCritical) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 1.5,
      children: [
        _buildMetricTile('Viscosity Index', '${t.viscosityIndex.toInt()}', t.viscosityIndex < 100, Icons.water_drop),
        _buildMetricTile('Dielectric', t.dielectricConstant.toStringAsFixed(1), t.dielectricConstant > 4.0, Icons.bolt),
        _buildMetricTile('Soot %', '${t.sootContaminationPercent.toStringAsFixed(1)}%', t.sootContaminationPercent > 4.0, Icons.blur_on),
        _buildMetricTile('Sump Temp', '${t.tempFahrenheit.toInt()}°', t.tempFahrenheit > 240, Icons.thermostat),
      ],
    );
  }

  Widget _buildMetricTile(String label, String value, bool isAlarm, IconData icon) {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isAlarm ? Colors.red : Colors.transparent),
      ),
      color: isAlarm ? Colors.red[50] : Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 16, color: isAlarm ? Colors.red : Colors.grey),
                const SizedBox(width: 4),
                Text(label, style: TextStyle(color: isAlarm ? Colors.red[900] : Colors.grey[700], fontSize: 12, fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 8),
            Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: isAlarm ? Colors.red[900] : Colors.black87)),
          ],
        ),
      ),
    );
  }
}
