import 'package:flutter/material.dart';
import '../models/route_deviation_immobilizer_model.dart';
import '../services/route_deviation_immobilizer_service.dart';

class RouteDeviationImmobilizerScreen extends StatefulWidget {
  const RouteDeviationImmobilizerScreen({super.key});

  @override
  State<RouteDeviationImmobilizerScreen> createState() => _RouteDeviationImmobilizerScreenState();
}

class _RouteDeviationImmobilizerScreenState extends State<RouteDeviationImmobilizerScreen> {
  final RouteDeviationImmobilizerService _service = RouteDeviationImmobilizerService();
  RouteDeviationStatus? _status;

  @override
  void initState() {
    super.initState();
    _service.deviationStream.listen((data) {
      if (mounted) setState(() => _status = data);
    });
    _service.simulateHijackingAttempt();
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
        title: const Text('High-Value Cargo Security'),
        backgroundColor: Colors.black,
      ),
      backgroundColor: Colors.grey[900],
      body: _status == null
          ? const Center(child: CircularProgressIndicator())
          : _buildSecurityDashboard(),
    );
  }

  Widget _buildSecurityDashboard() {
    final s = _status!;
    
    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _buildDeviationTracker(s),
                const SizedBox(height: 48),
                _buildEcmStatus(s),
              ],
            ),
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(RouteDeviationStatus s) {
    Color headerColor = Colors.green[800]!;
    IconData icon = Icons.shield;
    
    if (s.status == 'Warning') {
      headerColor = Colors.orange[800]!;
      icon = Icons.warning;
    } else if (s.status == 'Immobilized') {
      headerColor = Colors.red[900]!;
      icon = Icons.lock;
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
          Text(s.status.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 2)),
          const SizedBox(height: 8),
          Text(s.message, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 16)),
        ],
      ),
    );
  }

  Widget _buildDeviationTracker(RouteDeviationStatus s) {
    double progress = (s.currentDeviationMiles / (s.allowedDeviationMiles * 2)).clamp(0.0, 1.0);
    Color barColor = Colors.greenAccent;
    if (s.status == 'Warning') barColor = Colors.orangeAccent;
    if (s.status == 'Immobilized') barColor = Colors.redAccent;

    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(color: Colors.black, borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.grey[800]!)),
      child: Column(
        children: [
          const Text('ROUTE DEVIATION TRACKER', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('${s.currentDeviationMiles.toStringAsFixed(1)} MI OFF ROUTE', style: TextStyle(color: barColor, fontSize: 20, fontWeight: FontWeight.bold)),
              Text('LIMIT: ${s.allowedDeviationMiles} MI', style: const TextStyle(color: Colors.grey)),
            ],
          ),
          const SizedBox(height: 16),
          LinearProgressIndicator(
            value: progress,
            backgroundColor: Colors.grey[900],
            color: barColor,
            minHeight: 12,
            borderRadius: BorderRadius.circular(6),
          ),
        ],
      ),
    );
  }

  Widget _buildEcmStatus(RouteDeviationStatus s) {
    bool isLimpMode = s.status == 'Immobilized';
    
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(color: isLimpMode ? Colors.red[900]!.withOpacity(0.3) : Colors.black, borderRadius: BorderRadius.circular(16), border: Border.all(color: isLimpMode ? Colors.redAccent : Colors.grey[800]!)),
      child: Row(
        children: [
          Icon(Icons.speed, color: isLimpMode ? Colors.redAccent : Colors.white, size: 48),
          const SizedBox(width: 24),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('ECM SPEED GOVERNOR', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 4),
                Text('${s.speedLimitMph} MPH', style: TextStyle(color: isLimpMode ? Colors.redAccent : Colors.white, fontSize: 32, fontWeight: FontWeight.bold)),
                if (isLimpMode) const Text('Limp mode engaged to prevent theft.', style: TextStyle(color: Colors.redAccent, fontSize: 12)),
              ],
            ),
          )
        ],
      ),
    );
  }
}
