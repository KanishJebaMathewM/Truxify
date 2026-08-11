import 'package:flutter/material.dart';
import '../models/battery_health_model.dart';
import '../services/battery_analytics_service.dart';

class BatteryHealthDashboard extends StatefulWidget {
  const BatteryHealthDashboard({super.key});

  @override
  State<BatteryHealthDashboard> createState() => _BatteryHealthDashboardState();
}

class _BatteryHealthDashboardState extends State<BatteryHealthDashboard> {
  final BatteryAnalyticsService _analyticsService = BatteryAnalyticsService();
  List<BatteryHealth> _fleetBatteries = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() async {
    final data = await _analyticsService.getFleetBatteryStatus();
    if (mounted) {
      setState(() {
        _fleetBatteries = data;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Predictive Battery Analytics'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _fleetBatteries.length,
              itemBuilder: (context, index) {
                return _buildBatteryCard(_fleetBatteries[index]);
              },
            ),
    );
  }

  Widget _buildBatteryCard(BatteryHealth battery) {
    final isCritical = battery.status == 'Critical';
    final isWarning = battery.status == 'Warning';
    
    final statusColor = isCritical ? Colors.red[700]! : (isWarning ? Colors.orange[700]! : Colors.green[700]!);

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: statusColor.withOpacity(0.1),
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(Icons.battery_charging_full, color: statusColor),
                    const SizedBox(width: 8),
                    Text(battery.truckId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    battery.status.toUpperCase(),
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12),
                  ),
                )
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _buildTelemetryStat('Resting', '${battery.currentVoltage}V'),
                    _buildTelemetryStat('Crank Drop', '${battery.crankingVoltageDrop}V'),
                    _buildTelemetryStat('Alternator', '${battery.alternatorOutput}V'),
                  ],
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.grey[100],
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: isCritical ? Colors.red[200]! : Colors.grey[300]!),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.memory, color: Colors.blueGrey[700]),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('ML Prediction Model', style: TextStyle(color: Colors.grey, fontSize: 12)),
                            const SizedBox(height: 4),
                            Text(
                              isCritical 
                                ? 'Failure imminent within ${battery.daysToFailurePrediction} days.'
                                : isWarning 
                                  ? 'Performance degrading. Inspect in ${battery.daysToFailurePrediction} days.'
                                  : 'Optimal health. No issues predicted.',
                              style: TextStyle(fontWeight: FontWeight.bold, color: Colors.blueGrey[900]),
                            )
                          ],
                        ),
                      )
                    ],
                  ),
                ),
                if (isCritical || isWarning) ...[
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: () {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Scheduled replacement for ${battery.truckId}.'))
                        );
                      },
                      icon: const Icon(Icons.build),
                      label: const Text('SCHEDULE REPLACEMENT'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.blueGrey[900],
                        foregroundColor: Colors.white,
                      ),
                    ),
                  )
                ]
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildTelemetryStat(String label, String value) {
    return Column(
      children: [
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
