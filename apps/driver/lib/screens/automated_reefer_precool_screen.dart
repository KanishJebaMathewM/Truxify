import 'package:flutter/material.dart';
import '../models/automated_reefer_precool_model.dart';
import '../services/automated_reefer_precool_service.dart';

class AutomatedReeferPrecoolScreen extends StatefulWidget {
  const AutomatedReeferPrecoolScreen({super.key});

  @override
  State<AutomatedReeferPrecoolScreen> createState() => _AutomatedReeferPrecoolScreenState();
}

class _AutomatedReeferPrecoolScreenState extends State<AutomatedReeferPrecoolScreen> {
  final AutomatedReeferPrecoolService _service = AutomatedReeferPrecoolService();
  ReeferTelemetry? _telemetry;

  @override
  void initState() {
    super.initState();
    _service.telemetryStream.listen((data) {
      if (mounted) setState(() => _telemetry = data);
    });
    _service.simulateJourney();
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
        title: const Text('AI Reefer Pre-cooling'),
        backgroundColor: Colors.cyan[900],
      ),
      backgroundColor: Colors.grey[900],
      body: _telemetry == null 
        ? const Center(child: CircularProgressIndicator(color: Colors.cyan))
        : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final t = _telemetry!;
    final isCooling = t.coolingMode.contains('Pre-cool');
    final isReady = t.isReadyForPickup;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          _buildWeatherEtaCard(t),
          const SizedBox(height: 24),
          _buildTemperatureDial(t),
          const SizedBox(height: 24),
          _buildStatusBanner(isCooling, isReady),
          const SizedBox(height: 24),
          _buildMetricsGrid(t),
        ],
      ),
    );
  }

  Widget _buildWeatherEtaCard(ReeferTelemetry t) {
    return Card(
      color: Colors.grey[850],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Shipper ETA', style: TextStyle(color: Colors.grey)),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Icon(Icons.schedule, color: Colors.cyan[400], size: 20),
                    const SizedBox(width: 8),
                    const Text('1 hr 45 min', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                  ],
                ),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                const Text('Local Weather', style: TextStyle(color: Colors.grey)),
                const SizedBox(height: 4),
                Row(
                  children: [
                    const Text('Extreme Heat', style: TextStyle(color: Colors.white54, fontSize: 12)),
                    const SizedBox(width: 8),
                    Text('${t.ambientOutsideTempF.toStringAsFixed(1)}°F', style: const TextStyle(color: Colors.orangeAccent, fontSize: 18, fontWeight: FontWeight.bold)),
                    const SizedBox(width: 4),
                    const Icon(Icons.wb_sunny, color: Colors.orangeAccent, size: 20),
                  ],
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTemperatureDial(ReeferTelemetry t) {
    Color tempColor = Colors.cyan;
    if (t.currentInternalTempF > 50) tempColor = Colors.redAccent;
    else if (t.currentInternalTempF > 0) tempColor = Colors.orangeAccent;

    return Container(
      width: 250,
      height: 250,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: Colors.black,
        border: Border.all(color: tempColor, width: 4),
        boxShadow: [BoxShadow(color: tempColor.withOpacity(0.3), blurRadius: 30, spreadRadius: 10)],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text('INTERNAL TEMP', style: TextStyle(color: Colors.grey, fontSize: 12, letterSpacing: 1.5)),
          const SizedBox(height: 8),
          Text('${t.currentInternalTempF.toStringAsFixed(1)}°', style: TextStyle(color: tempColor, fontSize: 64, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('TARGET: ${t.targetLoadTempF.toStringAsFixed(1)}°F', style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildStatusBanner(bool isCooling, bool isReady) {
    if (isReady) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.green[900], borderRadius: BorderRadius.circular(12)),
        child: const Column(
          children: [
            Icon(Icons.check_circle, color: Colors.greenAccent, size: 40),
            SizedBox(height: 8),
            Text('TRAILER READY FOR PICKUP', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
            Text('Target temp achieved. Eco-mode active.', style: TextStyle(color: Colors.white70)),
          ],
        ),
      );
    }
    
    if (isCooling) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.cyan[900], borderRadius: BorderRadius.circular(12)),
        child: const Column(
          children: [
            SizedBox(height: 30, width: 30, child: CircularProgressIndicator(color: Colors.cyanAccent, strokeWidth: 3)),
            SizedBox(height: 12),
            Text('AUTO PRE-COOLING ACTIVE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
            Text('AI overriding manual controls due to heat index.', style: TextStyle(color: Colors.white70)),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.grey[850], borderRadius: BorderRadius.circular(12)),
      child: const Text('REEFER OFF', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, fontSize: 18)),
    );
  }

  Widget _buildMetricsGrid(ReeferTelemetry t) {
    return Row(
      children: [
        Expanded(child: _buildMetricCard('Cooling Mode', t.coolingMode, Icons.ac_unit)),
        const SizedBox(width: 16),
        Expanded(child: _buildMetricCard('Time to Target', t.estimatedTimeToTargetMinutes > 0 ? '${t.estimatedTimeToTargetMinutes.toInt()} min' : '--', Icons.timer)),
      ],
    );
  }

  Widget _buildMetricCard(String title, String value, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.grey[850], borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: Colors.cyan, size: 16),
              const SizedBox(width: 8),
              Text(title, style: const TextStyle(color: Colors.grey, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 8),
          Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
        ],
      ),
    );
  }
}
