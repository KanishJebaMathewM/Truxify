import 'package:flutter/material.dart';
import '../models/cargo_shift_detection_model.dart';
import '../services/cargo_shift_detection_service.dart';

class CargoShiftDetectionScreen extends StatefulWidget {
  const CargoShiftDetectionScreen({super.key});

  @override
  State<CargoShiftDetectionScreen> createState() => _CargoShiftDetectionScreenState();
}

class _CargoShiftDetectionScreenState extends State<CargoShiftDetectionScreen> {
  final CargoShiftDetectionService _service = CargoShiftDetectionService();
  SuspensionTelemetry? _telemetry;

  @override
  void initState() {
    super.initState();
    _service.sensorStream.listen((data) {
      if (mounted) setState(() => _telemetry = data);
    });
    _service.simulateCargoShift();
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
        title: const Text('Dynamic Cargo Shift Sensor'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _telemetry == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final t = _telemetry!;
    
    return Column(
      children: [
        _buildStatusHeader(t),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildTrailerVisualizer(t),
              const SizedBox(height: 24),
              const Text('LIVE SUSPENSION TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildTelemetryGrid(t),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(SuspensionTelemetry t) {
    Color headerColor = Colors.green[700]!;
    IconData icon = Icons.balance;
    
    if (t.status == 'Warning') {
      headerColor = Colors.orange[800]!;
      icon = Icons.warning;
    } else if (t.status == 'Critical Shift') {
      headerColor = Colors.red[900]!;
      icon = Icons.fire_truck;
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 500),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: headerColor,
      child: Column(
        children: [
          Icon(icon, color: Colors.white, size: 56),
          const SizedBox(height: 16),
          Text(t.status.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 2)),
          const SizedBox(height: 8),
          Text(t.systemMessage, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 16)),
        ],
      ),
    );
  }

  Widget _buildTrailerVisualizer(SuspensionTelemetry t) {
    bool isShifted = t.status == 'Critical Shift';
    
    return Container(
      height: 200,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.grey[300]!)),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Trailer Outline
          Container(
            width: 150,
            height: 120,
            decoration: BoxDecoration(
              border: Border.all(color: Colors.blueGrey, width: 4),
              borderRadius: BorderRadius.circular(8),
            ),
          ),
          // Cargo Block
          AnimatedPositioned(
            duration: const Duration(milliseconds: 500),
            left: isShifted ? 20 : 50, // Shifts left visually
            bottom: 20,
            child: AnimatedRotation(
              turns: isShifted ? -0.05 : 0.0, // Tilts visually
              duration: const Duration(milliseconds: 500),
              child: Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                  color: isShifted ? Colors.redAccent.withOpacity(0.5) : Colors.green.withOpacity(0.5),
                  border: Border.all(color: isShifted ? Colors.red : Colors.green, width: 2),
                ),
                child: const Center(child: Icon(Icons.inventory_2, color: Colors.white)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTelemetryGrid(SuspensionTelemetry t) {
    bool isDanger = t.status == 'Critical Shift';

    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(child: _buildMetricCard('Left Airbag PSI', '${t.leftAirbagPsi.toStringAsFixed(1)} PSI', Icons.tire_repair, isDanger)),
            const SizedBox(width: 12),
            Expanded(child: _buildMetricCard('Right Airbag PSI', '${t.rightAirbagPsi.toStringAsFixed(1)} PSI', Icons.tire_repair, isDanger)),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(child: _buildMetricCard('Weight Delta', '${t.weightDistributionDeltaPct.toStringAsFixed(1)}%', Icons.compare_arrows, isDanger)),
            const SizedBox(width: 12),
            Expanded(child: _buildMetricCard('Lateral G-Force', '${t.lateralGForce.toStringAsFixed(2)} G', Icons.speed, t.status == 'Warning')),
          ],
        ),
      ],
    );
  }

  Widget _buildMetricCard(String label, String value, IconData icon, bool highlight) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: highlight ? Colors.redAccent : Colors.grey[300]!, width: highlight ? 2 : 1)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: highlight ? Colors.redAccent : Colors.blueGrey, size: 24),
          const SizedBox(height: 12),
          Text(value, style: TextStyle(color: highlight ? Colors.redAccent : Colors.black87, fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
        ],
      ),
    );
  }
}
