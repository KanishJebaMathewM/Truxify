import 'package:flutter/material.dart';
import '../models/wind_tip_over_model.dart';
import '../services/wind_tip_over_service.dart';

class WindTipOverScreen extends StatefulWidget {
  const WindTipOverScreen({super.key});

  @override
  State<WindTipOverScreen> createState() => _WindTipOverScreenState();
}

class _WindTipOverScreenState extends State<WindTipOverScreen> {
  final WindTipOverService _service = WindTipOverService();
  WindRiskSession? _session;

  @override
  void initState() {
    super.initState();
    _service.riskStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateWindRisk();
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
        title: const Text('Aerodynamic Risk Engine'),
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
    bool isCritical = s.tipOverRiskScore >= 90;
    bool isWarning = s.tipOverRiskScore >= 70 && s.tipOverRiskScore < 90;

    return Column(
      children: [
        _buildStatusHeader(s, isWarning, isCritical),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildDirectiveCard(s, isCritical),
              const SizedBox(height: 24),
              const Text('NOAA WIND TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildTelemetryGrid(s.weatherData, isCritical),
              const SizedBox(height: 24),
              _buildWeightFactorCard(s.truckGrossWeightLbs),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(WindRiskSession s, bool isWarning, bool isCritical) {
    Color headerColor = Colors.blueGrey[800]!;
    IconData icon = Icons.air;
    
    if (isWarning) {
      headerColor = Colors.orange[900]!;
      icon = Icons.warning_amber;
    } else if (isCritical) {
      headerColor = Colors.red[900]!;
      icon = Icons.dangerous;
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
              const Text('AERODYNAMIC AI', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          LinearProgressIndicator(
            value: s.tipOverRiskScore / 100,
            backgroundColor: Colors.white24,
            color: Colors.white,
            minHeight: 8,
          ),
          const SizedBox(height: 8),
          Text(
            'Blowover Risk Index: ${s.tipOverRiskScore.toInt()}/100',
            style: const TextStyle(color: Colors.white70, fontSize: 12)
          ),
        ],
      ),
    );
  }

  Widget _buildDirectiveCard(WindRiskSession s, bool isCritical) {
    return Card(
      elevation: isCritical ? 8 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isCritical ? Colors.redAccent : Colors.transparent, width: 2),
      ),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: isCritical ? Colors.red[50] : Colors.white,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          children: [
            Text('SYSTEM DIRECTIVE', style: TextStyle(color: isCritical ? Colors.red[900] : Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (isCritical) ...[
                  const Icon(Icons.notifications_active, color: Colors.red, size: 32),
                  const SizedBox(width: 12),
                ],
                Expanded(
                  child: Text(s.systemDirective, textAlign: TextAlign.center, style: TextStyle(color: isCritical ? Colors.red[900] : Colors.black87, fontSize: 18, fontWeight: FontWeight.bold)),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTelemetryGrid(WeatherTelemetry w, bool isCritical) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(child: _buildMetricCard('Gust Speed', '${w.maxGustSpeedMph.toInt()} mph', Icons.speed, w.maxGustSpeedMph > 50)),
            const SizedBox(width: 12),
            Expanded(child: _buildMetricCard('Crosswind Angle', '${w.crosswindAngleDegrees.toInt()}°', Icons.explore, w.crosswindAngleDegrees > 60 && w.crosswindAngleDegrees < 120)),
          ],
        ),
        const SizedBox(height: 12),
        Card(
           elevation: 2,
           shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
           child: Padding(
             padding: const EdgeInsets.all(16),
             child: Row(
               mainAxisAlignment: MainAxisAlignment.spaceBetween,
               children: [
                 const Column(
                   crossAxisAlignment: CrossAxisAlignment.start,
                   children: [
                     Text('Sustained Wind', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                     Text('Base air speed', style: TextStyle(color: Colors.grey, fontSize: 12)),
                   ],
                 ),
                 Text('${w.currentWindSpeedMph.toInt()} mph', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: isCritical ? Colors.red[900] : Colors.blueGrey)),
               ],
             ),
           ),
        )
      ],
    );
  }

  Widget _buildMetricCard(String label, String value, IconData icon, bool isDanger) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isDanger ? Colors.orangeAccent : Colors.grey[200]!),
      ),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isDanger ? Colors.orange[50] : Colors.white,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Icon(icon, color: isDanger ? Colors.orange[900] : Colors.blueGrey[400]),
            const SizedBox(height: 8),
            Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24, color: isDanger ? Colors.orange[900] : Colors.black87)),
            Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  Widget _buildWeightFactorCard(int weightLbs) {
    bool isEmpty = weightLbs < 40000;
    return Card(
      elevation: isEmpty ? 4 : 2,
      color: isEmpty ? Colors.red[900] : Colors.blueGrey[800],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
             Column(
               crossAxisAlignment: CrossAxisAlignment.start,
               children: [
                 Text('PAYLOAD MODIFIER: ${isEmpty ? 'EMPTY' : 'LOADED'}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                 const SizedBox(height: 4),
                 Text(isEmpty ? 'Extreme Sail Effect Risk' : 'Mass providing stability', style: const TextStyle(color: Colors.white70, fontSize: 12)),
               ],
             ),
             Text('${weightLbs / 1000}k lbs', style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
  }
}
