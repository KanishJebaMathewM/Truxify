import 'package:flutter/material.dart';
import '../models/tire_analytics_model.dart';
import '../services/tpms_analytics_service.dart';
import '../services/edge_tpms_service.dart';
class TireHealthDashboard extends StatefulWidget {
  const TireHealthDashboard({super.key});

  @override
  State<TireHealthDashboard> createState() => _TireHealthDashboardState();
}

class _TireHealthDashboardState extends State<TireHealthDashboard> {
  final TpmsAnalyticsService _tpmsService = TpmsAnalyticsService();
  final EdgeTpmsService _edgeService = EdgeTpmsService();
  List<TireAnalytics> _tires = [];
  bool _isLoading = true;
  bool _alertActive = false;

  @override
  void initState() {
    super.initState();
    _loadData();
    _edgeService.alertStream.listen((alert) {
      if (mounted && !_alertActive) {
        _alertActive = true;
        _showCriticalAlert(alert);
      }
    });
    _edgeService.simulateHighFrequencyData();
  }

  @override
  void dispose() {
    _edgeService.dispose();
    super.dispose();
  }

  void _showCriticalAlert(TpmsAlert alert) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.red[900],
        title: const Row(
          children: [
            Icon(Icons.warning, color: Colors.white, size: 40),
            SizedBox(width: 10),
            Expanded(child: Text('CRITICAL BLOWOUT RISK', style: TextStyle(color: Colors.white))),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              alert.message,
              style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 10),
            Text(
              'Pressure dropped ${alert.pressureDrop.toStringAsFixed(1)} PSI in ${alert.timeWindowMs} ms.',
              style: const TextStyle(color: Colors.white70),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(context).pop();
              _alertActive = false;
            },
            child: const Text('DISMISS', style: TextStyle(color: Colors.white)),
          )
        ],
      ),
    );
  }

  void _loadData() async {
    final tires = await _tpmsService.getLiveTireHealth();
    if (mounted) {
      setState(() {
        _tires = tires;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Predictive Tire Analytics'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildHeader(),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _tires.length,
                    itemBuilder: (context, index) {
                      return _buildTireCard(_tires[index]);
                    },
                  ),
                )
              ],
            ),
    );
  }

  Widget _buildHeader() {
    final criticalCount = _tires.where((t) => t.isCritical).length;
    final hasCritical = criticalCount > 0;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: hasCritical ? Colors.red[900] : Colors.green[800],
      child: Column(
        children: [
          Icon(hasCritical ? Icons.warning : Icons.check_circle, color: Colors.white, size: 64),
          const SizedBox(height: 16),
          Text(
            hasCritical ? '$criticalCount CRITICAL ALERTS' : 'FLEET TIRES OPTIMAL',
            style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text(
            hasCritical 
                ? 'High probability of blowout detected. Route to nearest service center.'
                : 'All monitored tires are within safe operational thresholds.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white70, fontSize: 16),
          )
        ],
      ),
    );
  }

  Widget _buildTireCard(TireAnalytics tire) {
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: tire.isCritical ? Colors.red : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.tire_repair, color: tire.isCritical ? Colors.red : Colors.blueGrey),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(tire.tirePosition, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: tire.isCritical ? Colors.red[100] : Colors.green[100],
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    '${tire.blowoutRiskPercentage}% Risk',
                    style: TextStyle(color: tire.isCritical ? Colors.red[900] : Colors.green[900], fontWeight: FontWeight.bold),
                  ),
                )
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _buildMetric('Pressure', '${tire.currentPressurePsi} PSI', tire.currentPressurePsi < 95 ? Colors.red : Colors.black),
                _buildMetric('Temperature', '${tire.currentTempF} °F', tire.currentTempF > 130 ? Colors.red : Colors.black),
                _buildMetric('Est. Tread', '${tire.estimatedTreadDepthMm} mm', tire.estimatedTreadDepthMm < 4.0 ? Colors.red : Colors.black),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.grey[100], borderRadius: BorderRadius.circular(8)),
              child: Text(
                tire.recommendation,
                style: TextStyle(color: tire.isCritical ? Colors.red[900] : Colors.blueGrey[800], fontWeight: FontWeight.w500),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, Color valueColor) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: valueColor)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
