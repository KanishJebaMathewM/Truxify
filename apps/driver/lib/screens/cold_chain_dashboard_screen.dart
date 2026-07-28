import 'package:flutter/material.dart';
import '../models/reefer_temperature_model.dart';
import '../services/cold_chain_iot_service.dart';

class ColdChainDashboardScreen extends StatefulWidget {
  const ColdChainDashboardScreen({super.key});

  @override
  State<ColdChainDashboardScreen> createState() => _ColdChainDashboardScreenState();
}

class _ColdChainDashboardScreenState extends State<ColdChainDashboardScreen> {
  final ColdChainIotService _iotService = ColdChainIotService();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Cold Chain Monitor'),
        backgroundColor: Colors.indigo[900],
      ),
      body: StreamBuilder<ReeferTemperature>(
        stream: _iotService.streamTemperatureData('TRL-REEF-9942'),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text('Sensor Error: ${snapshot.error}'));
          }
          if (!snapshot.hasData) {
            return const Center(child: Text('Awaiting Sensor Data...'));
          }

          final data = snapshot.data!;
          final statusColor = data.isCritical ? Colors.red : Colors.green;
          final statusIcon = data.isCritical ? Icons.warning_amber_rounded : Icons.check_circle_outline;
          final statusText = data.isCritical ? 'CRITICAL: TEMP OUT OF RANGE' : 'Temperature Stable';

          return Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Card(
                  elevation: 8,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                    side: BorderSide(color: statusColor, width: 3),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 32.0, horizontal: 16.0),
                    child: Column(
                      children: [
                        Icon(statusIcon, size: 64, color: statusColor),
                        const SizedBox(height: 16),
                        Text(
                          '${data.currentTempCelsius.toStringAsFixed(1)} °C',
                          style: TextStyle(fontSize: 64, fontWeight: FontWeight.bold, color: statusColor),
                        ),
                        const SizedBox(height: 8),
                        Text(statusText, style: TextStyle(fontSize: 20, color: statusColor, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 32),
                const Text('Live Sensor Metrics', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                const Divider(),
                _buildMetricRow('Trailer ID', data.trailerId),
                _buildMetricRow('Safe Range', '${data.safeTempMin} °C to ${data.safeTempMax} °C'),
                _buildMetricRow('Humidity', '${data.humidityPercentage.toStringAsFixed(1)} %'),
                _buildMetricRow('Last Updated', '${data.timestamp.hour}:${data.timestamp.minute.toString().padLeft(2, '0')}:${data.timestamp.second.toString().padLeft(2, '0')}'),
                
                const Spacer(),
                if (data.isCritical)
                  ElevatedButton.icon(
                    onPressed: () {
                      // Trigger emergency dispatch flow
                    },
                    icon: const Icon(Icons.emergency),
                    label: const Text('DISPATCH EMERGENCY REPAIR'),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      backgroundColor: Colors.red,
                      foregroundColor: Colors.white,
                    ),
                  )
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildMetricRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 18, color: Colors.grey)),
          Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
