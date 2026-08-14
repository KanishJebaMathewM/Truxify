import 'package:flutter/material.dart';
import '../models/obd_telemetry_model.dart';
import '../services/obd_service.dart';

class VehicleHealthScreen extends StatefulWidget {
  const VehicleHealthScreen({super.key});

  @override
  State<VehicleHealthScreen> createState() => _VehicleHealthScreenState();
}

class _VehicleHealthScreenState extends State<VehicleHealthScreen> {
  final ObdService _obdService = ObdService();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Predictive Fleet Maintenance'),
        backgroundColor: Colors.blueGrey[900],
      ),
      body: StreamBuilder<ObdTelemetry>(
        stream: _obdService.getTelemetryStream(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text('Error connecting to OBD-II: ${snapshot.error}'));
          }
          if (!snapshot.hasData) {
            return const Center(child: Text('No Telemetry Data Available'));
          }

          final data = snapshot.data!;
          final isHealthy = (data.predictiveHealthScore ?? 0) > 80;

          return Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildHealthScoreCard(data.predictiveHealthScore ?? 0, isHealthy),
                const SizedBox(height: 20),
                const Text(
                  'Live OBD-II Telemetry',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 10),
                _buildTelemetryRow('Engine Temp', data.engineTemperature != null ? '${data.engineTemperature!.toStringAsFixed(1)} °F' : 'N/A', (data.engineTemperature ?? 0) > 205 ? Colors.red : Colors.green),
                _buildTelemetryRow('Oil Level', data.oilLevel != null ? '${data.oilLevel!.toStringAsFixed(1)} %' : 'N/A', Colors.blue),
                _buildTelemetryRow('Tire Pressure', data.tirePressureAvg != null ? '${data.tirePressureAvg!.toStringAsFixed(1)} PSI' : 'N/A', Colors.green),
                _buildTelemetryRow('DEF Urea Concentration', data.defUreaConcentration != null ? '${data.defUreaConcentration!.toStringAsFixed(1)} %' : 'N/A', (data.defUreaConcentration ?? 32.5) < 30.0 ? Colors.red : Colors.green),
                _buildTelemetryRow('NOx Level', data.noxLevel != null ? '${data.noxLevel!.toStringAsFixed(1)} ppm' : 'N/A', Colors.orange),
                const SizedBox(height: 20),
                if (data.warnings.isNotEmpty) ...[
                  const Text(
                    'Predictive Alerts',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.red),
                  ),
                  const SizedBox(height: 10),
                  ...data.warnings.map((w) => _buildWarningBanner(w)).toList(),
                ]
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildHealthScoreCard(double score, bool isHealthy) {
    return Card(
      color: isHealthy ? Colors.green[100] : Colors.red[100],
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'Predictive Health Score',
              style: TextStyle(fontSize: 18, color: isHealthy ? Colors.green[900] : Colors.red[900]),
            ),
            Text(
              '${score.toStringAsFixed(0)}/100',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: isHealthy ? Colors.green[900] : Colors.red[900]),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTelemetryRow(String label, String value, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 16)),
          Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: color)),
        ],
      ),
    );
  }

  Widget _buildWarningBanner(String warning) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8.0),
      padding: const EdgeInsets.all(12.0),
      decoration: BoxDecoration(
        color: Colors.red[50],
        border: Border.all(color: Colors.red),
        borderRadius: BorderRadius.circular(8.0),
      ),
      child: Row(
        children: [
          const Icon(Icons.warning, color: Colors.red),
          const SizedBox(width: 10),
          Expanded(child: Text(warning, style: const TextStyle(color: Colors.red))),
        ],
      ),
    );
  }
}
