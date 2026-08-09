import 'package:flutter/material.dart';
import '../models/v2x_traffic_preemption_model.dart';
import '../services/v2x_traffic_preemption_service.dart';

class V2XTrafficPreemptionScreen extends StatefulWidget {
  const V2XTrafficPreemptionScreen({super.key});

  @override
  State<V2XTrafficPreemptionScreen> createState() => _V2XTrafficPreemptionScreenState();
}

class _V2XTrafficPreemptionScreenState extends State<V2XTrafficPreemptionScreen> {
  final V2XTrafficPreemptionService _service = V2XTrafficPreemptionService();
  V2XPreemptionStatus? _status;

  @override
  void initState() {
    super.initState();
    _service.v2xStream.listen((data) {
      if (mounted) setState(() => _status = data);
    });
    _service.simulateApproach();
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
        title: const Text('Smart City V2X'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.black,
      body: _status == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _status!;
    
    return Column(
      children: [
        _buildV2XHeader(s),
        Expanded(
          child: Center(
            child: s.upcomingIntersection != null
                ? _buildIntersectionVisualizer(s)
                : const Text('No smart intersections ahead.', style: TextStyle(color: Colors.grey, fontSize: 18)),
          ),
        ),
        _buildTelemetryFooter(s),
      ],
    );
  }

  Widget _buildV2XHeader(V2XPreemptionStatus s) {
    Color headerColor = Colors.blueGrey[800]!;
    if (s.isPreemptionRequested && !s.isPreemptionGranted) headerColor = Colors.amber[800]!;
    if (s.isPreemptionGranted) headerColor = Colors.green[800]!;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 500),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: headerColor,
      child: Column(
        children: [
          Icon(
            s.isPreemptionGranted ? Icons.security_update_good : (s.isPreemptionRequested ? Icons.wifi_tethering : Icons.sensors),
            color: Colors.white,
            size: 48,
          ),
          const SizedBox(height: 16),
          Text(s.message, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildIntersectionVisualizer(V2XPreemptionStatus s) {
    final intsec = s.upcomingIntersection!;
    
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(intsec.name, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Text('${intsec.distanceFeet.toInt()} ft ahead', style: const TextStyle(color: Colors.grey, fontSize: 18)),
        const SizedBox(height: 48),
        Container(
          padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
          decoration: BoxDecoration(color: Colors.grey[900], borderRadius: BorderRadius.circular(32), border: Border.all(color: Colors.grey[800]!)),
          child: Column(
            children: [
              _buildLightBulb(Colors.red, false),
              const SizedBox(height: 16),
              _buildLightBulb(Colors.yellow, false),
              const SizedBox(height: 16),
              _buildLightBulb(Colors.green, true, glow: s.isPreemptionGranted),
            ],
          ),
        ),
        const SizedBox(height: 32),
        Text('${intsec.secondsUntilChange}s', style: TextStyle(color: s.isPreemptionGranted ? Colors.greenAccent : Colors.white, fontSize: 64, fontWeight: FontWeight.bold)),
        const Text('UNTIL RED', style: TextStyle(color: Colors.grey, letterSpacing: 2)),
      ],
    );
  }

  Widget _buildLightBulb(Color color, bool isActive, {bool glow = false}) {
    return Container(
      width: 64,
      height: 64,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: isActive ? color : color.withOpacity(0.2),
        boxShadow: isActive && glow
            ? [BoxShadow(color: color.withOpacity(0.8), blurRadius: 20, spreadRadius: 5)]
            : null,
      ),
    );
  }

  Widget _buildTelemetryFooter(V2XPreemptionStatus s) {
    return Container(
      padding: const EdgeInsets.all(24),
      color: Colors.grey[900],
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _buildTelemetryMetric('SPEED', '${s.currentSpeedMph.toInt()} MPH'),
          _buildTelemetryMetric('WEIGHT', '${(s.vehicleWeightLbs / 1000).toStringAsFixed(1)}k LBS'),
          _buildTelemetryMetric('V2X LINK', s.isV2XActive ? 'ACTIVE' : 'OFF', color: s.isV2XActive ? Colors.blueAccent : Colors.grey),
        ],
      ),
    );
  }

  Widget _buildTelemetryMetric(String label, String value, {Color color = Colors.white}) {
    return Column(
      children: [
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1)),
        const SizedBox(height: 4),
        Text(value, style: TextStyle(color: color, fontSize: 20, fontWeight: FontWeight.bold)),
      ],
    );
  }
}
