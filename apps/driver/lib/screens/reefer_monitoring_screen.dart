import 'package:flutter/material.dart';
import '../models/reefer_temperature_model.dart';
import '../services/reefer_anomaly_service.dart';

class ReeferMonitoringScreen extends StatefulWidget {
  const ReeferMonitoringScreen({super.key});

  @override
  State<ReeferMonitoringScreen> createState() => _ReeferMonitoringScreenState();
}

class _ReeferMonitoringScreenState extends State<ReeferMonitoringScreen> {
  final ReeferAnomalyService _anomalyService = ReeferAnomalyService();
  List<ReeferZone> _zones = [];

  @override
  void initState() {
    super.initState();
    _startMonitoring();
  }

  void _startMonitoring() {
    _anomalyService.monitorZones().listen((data) {
      if (mounted) {
        setState(() {
          _zones = data;
        });

        // Check for anomalies
        for (var zone in data) {
          if (zone.anomalyProbability > 0.90) {
            _triggerPredictionAlert(zone);
          }
        }
      }
    });
  }

  void _triggerPredictionAlert(ReeferZone zone) {
    showDialog(
      context: context,
      barrierColor: Colors.orange.withOpacity(0.8),
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.white,
        title: const Row(
          children: [
            Icon(Icons.ac_unit, color: Colors.orange, size: 40),
            SizedBox(width: 16),
            Text('PREDICTIVE ALERT', style: TextStyle(color: Colors.orange, fontWeight: FontWeight.bold)),
          ],
        ),
        content: Text(
          'ML Model detects a high probability of thermal failure in ${zone.zoneId}. Expected breach in ${zone.estimatedMinutesToFailure} minutes due to excessive compressor cycles and open doors.',
          style: const TextStyle(fontSize: 18),
        ),
        actions: [
          ElevatedButton(
            onPressed: () => Navigator.pop(context),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.orange[900], foregroundColor: Colors.white),
            child: const Text('ACKNOWLEDGE & INSPECT UNIT'),
          )
        ],
      )
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Reefer ML Monitor'),
        backgroundColor: Colors.blue[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _zones.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _zones.length,
              itemBuilder: (context, index) {
                return _buildZoneCard(_zones[index]);
              },
            ),
    );
  }

  Widget _buildZoneCard(ReeferZone zone) {
    final isWarning = zone.anomalyProbability > 0.50;
    final isCritical = zone.anomalyProbability > 0.90;

    Color headerColor = Colors.blue[800]!;
    if (isCritical) headerColor = Colors.red[800]!;
    else if (isWarning) headerColor = Colors.orange[800]!;

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            color: headerColor,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(zone.zoneId, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                if (isCritical)
                  const Icon(Icons.warning, color: Colors.white)
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _buildTempDisplay('Current', zone.currentTempF, isCritical ? Colors.red : Colors.blue),
                    _buildTempDisplay('Target', zone.targetTempF, Colors.grey),
                  ],
                ),
                const Divider(height: 32),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _buildStat('Compressor Cycles', '${zone.compressorCycleCount}'),
                    _buildStat('Ambient Temp', '${zone.ambientExternalTempF}°F'),
                    _buildStat('Door Status', zone.doorsOpen ? 'OPEN' : 'CLOSED', color: zone.doorsOpen ? Colors.orange : Colors.green),
                  ],
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(8)),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('ML Failure Prediction', style: TextStyle(fontWeight: FontWeight.bold)),
                          Text('${(zone.anomalyProbability * 100).toInt()}% Risk', style: TextStyle(color: headerColor, fontWeight: FontWeight.bold)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      LinearProgressIndicator(
                        value: zone.anomalyProbability,
                        backgroundColor: Colors.grey[300],
                        color: headerColor,
                        minHeight: 8,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      if (isWarning) ...[
                        const SizedBox(height: 8),
                        Text('Estimated safe time remaining: ${zone.estimatedMinutesToFailure} minutes', style: TextStyle(color: headerColor, fontSize: 12, fontWeight: FontWeight.bold)),
                      ]
                    ],
                  ),
                )
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildTempDisplay(String label, double temp, Color color) {
    return Column(
      children: [
        Text('${temp.toStringAsFixed(1)}°F', style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: color)),
        Text(label, style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
      ],
    );
  }

  Widget _buildStat(String label, String value, {Color color = Colors.black}) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: color)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 10)),
      ],
    );
  }
}
