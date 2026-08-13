import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/weather_analytics_model.dart';
import '../services/weather_analytics_service.dart';

class WeatherAnalyticsScreen extends StatefulWidget {
  const WeatherAnalyticsScreen({super.key});

  @override
  State<WeatherAnalyticsScreen> createState() => _WeatherAnalyticsScreenState();
}

class _WeatherAnalyticsScreenState extends State<WeatherAnalyticsScreen> {
  final WeatherAnalyticsService _service = WeatherAnalyticsService();
  WeatherAnalyticsSession? _session;

  @override
  void initState() {
    super.initState();
    _service.analyticsStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeDashboard();
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
        title: const Text('Weather Impact Analytics'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isAnalyzing == true ? null : () {
          _service.analyzeWinterRoute('Chicago, IL', 'Los Angeles, CA', DateTime(2026, 1, 15));
        },
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.ac_unit),
        label: const Text('Analyze Winter Route (Jan 15)'),
      ),
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
              if (s.segmentRisks.isNotEmpty) ...[
                _buildTotalImpactCard(s),
                const SizedBox(height: 24),
                const Text('HIGH-RISK ROUTE SEGMENTS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                ...s.segmentRisks.map((r) => _buildRiskCard(r)),
              ] else ...[
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('Tap Analyze to calculate historical weather impacts.', style: TextStyle(color: Colors.grey)),
                ))
              ],
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(WeatherAnalyticsSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isAnalyzing ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isAnalyzing 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.analytics, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('CLIMATE CORRELATION ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildTotalImpactCard(WeatherAnalyticsSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Colors.red, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              children: [
                const Icon(Icons.route, color: Colors.indigo),
                const SizedBox(width: 12),
                Expanded(child: Text('${s.origin} ➔ ${s.destination}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18))),
              ],
            ),
            const SizedBox(height: 4),
            Text('Scheduled: ${DateFormat('MMMM dd, yyyy').format(s.targetDeparture)}', style: const TextStyle(color: Colors.grey, fontStyle: FontStyle.italic)),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Required Schedule Extension', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, fontSize: 14)),
                Text('+${s.totalAddedTransitHours.toStringAsFixed(1)} HRS', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.red)),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.red[50], borderRadius: BorderRadius.circular(8)),
              child: const Text(
                'WARNING: Summer transit schedules will mathematically fail. You must extend the delivery window by the time listed above to account for historical winter speeds.',
                style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 12),
                textAlign: TextAlign.center,
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildRiskCard(WeatherRiskProfile risk) {
    Color riskColor = risk.riskLevel == 'Severe' ? Colors.red[900]! : (risk.riskLevel == 'High' ? Colors.orange[900]! : Colors.blue);
    
    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(child: Text(risk.routeSegment, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16))),
                Chip(
                  label: Text(risk.riskLevel.toUpperCase(), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 10)),
                  backgroundColor: riskColor,
                  visualDensity: VisualDensity.compact,
                )
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.cloudy_snowing, color: Colors.blueGrey, size: 16),
                const SizedBox(width: 8),
                Text(risk.historicalWeatherCondition, style: const TextStyle(color: Colors.blueGrey, fontStyle: FontStyle.italic)),
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('Summer Avg', '${risk.averageSummerSpeed.toStringAsFixed(0)} MPH', Colors.green),
                _buildMetric('Winter Avg', '${risk.historicalWinterSpeed.toStringAsFixed(0)} MPH', riskColor),
                _buildMetric('Impact', '+${risk.addedTransitTimeHours.toStringAsFixed(1)} HRS', Colors.red),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: color)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 10)),
      ],
    );
  }
}
