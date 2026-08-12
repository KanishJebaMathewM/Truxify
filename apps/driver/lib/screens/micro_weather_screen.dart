import 'package:flutter/material.dart';
import '../models/micro_weather_model.dart';
import '../services/micro_weather_service.dart';

class MicroWeatherScreen extends StatefulWidget {
  const MicroWeatherScreen({super.key});

  @override
  State<MicroWeatherScreen> createState() => _MicroWeatherScreenState();
}

class _MicroWeatherScreenState extends State<MicroWeatherScreen> {
  final MicroWeatherService _service = MicroWeatherService();
  MicroWeatherSession? _session;

  @override
  void initState() {
    super.initState();
    _service.weatherStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateWeatherEvent();
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
        title: const Text('P2P Micro-Weather AI'),
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

    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (s.isHazardDetected) ...[
                _buildHazardCard(s),
                const SizedBox(height: 24),
              ],
              const Text('FORWARD PEER TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...s.peerData.map((p) => _buildPeerCard(p)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(MicroWeatherSession s) {
    Color headerColor = s.isHazardDetected ? Colors.deepOrange[800]! : Colors.blueGrey[800]!;
    IconData icon = s.isHazardDetected ? Icons.thunderstorm : Icons.radar;

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
              const Text('CROWDSOURCED RADAR', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (!s.isHazardDetected) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildHazardCard(MicroWeatherSession s) {
    return Card(
      color: Colors.deepOrange[900],
      elevation: 8,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Icon(Icons.warning_amber_rounded, color: Colors.white, size: 48),
            const SizedBox(height: 16),
            Text(s.hazardType ?? 'Unknown Hazard', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
              child: Column(
                children: [
                  Text('AI SPEED LIMIT OVERRIDE', style: TextStyle(color: Colors.deepOrange[900], fontSize: 12, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  Text('${s.recommendedSpeedMph.toInt()} MPH', style: TextStyle(color: Colors.deepOrange[900], fontSize: 32, fontWeight: FontWeight.bold)),
                ],
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildPeerCard(PeerTelemetry p) {
    bool isWiperActive = p.wiperSpeed > 0;
    
    return Card(
      elevation: p.isTractionControlActive ? 4 : 1,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: p.isTractionControlActive ? Colors.deepOrange : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${p.distanceAheadMiles.toStringAsFixed(1)} Miles Ahead', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.blueGrey)),
                Text(p.truckId, style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            Row(
              children: [
                _buildSmallIconMetric(Icons.water_drop, isWiperActive ? 'Max' : 'Off', isWiperActive ? Colors.blue : Colors.grey),
                const SizedBox(width: 12),
                _buildSmallIconMetric(Icons.car_crash, p.isTractionControlActive ? 'SLIP' : 'Grip', p.isTractionControlActive ? Colors.deepOrange : Colors.green),
                const SizedBox(width: 12),
                _buildSmallIconMetric(Icons.thermostat, '${p.ambientTempF.toInt()}°', Colors.blueGrey),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildSmallIconMetric(IconData icon, String text, Color color) {
    return Column(
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(height: 4),
        Text(text, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 12)),
      ],
    );
  }
}
