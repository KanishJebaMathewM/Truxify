import 'package:flutter/material.dart';
import '../models/wim_telemetry_model.dart';
import '../services/wim_telemetry_service.dart';

class WimTelemetryScreen extends StatefulWidget {
  const WimTelemetryScreen({super.key});

  @override
  State<WimTelemetryScreen> createState() => _WimTelemetryScreenState();
}

class _WimTelemetryScreenState extends State<WimTelemetryScreen> {
  final WimTelemetryService _service = WimTelemetryService();
  WimSyncEvent? _event;

  @override
  void initState() {
    super.initState();
    _service.syncStream.listen((data) {
      if (mounted) setState(() => _event = data);
    });
    _service.simulateWimCrossing();
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
        title: const Text('DOT WIM Telemetry Sync'),
        backgroundColor: Colors.blue[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _event == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final e = _event!;
    
    return Column(
      children: [
        _buildStatusHeader(e),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text('AXLE WEIGHT COMPARISON', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (e.axleReadings.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Center(child: Text('Waiting to cross highway WIM sensors...', style: TextStyle(color: Colors.grey))),
                )
              else
                ...e.axleReadings.map((axle) => _buildAxleCard(axle)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(WimSyncEvent e) {
    Color headerColor = Colors.blue[800]!;
    IconData icon = Icons.sensors;
    
    if (e.status == 'WIM Dispute Detected') {
      headerColor = Colors.orange[800]!;
      icon = Icons.warning_amber_rounded;
    } else if (e.status == 'Bypass Granted') {
      headerColor = Colors.green[700]!;
      icon = Icons.check_circle_outline;
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
              Text(e.weighStationName, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 24),
          Text(e.status.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(8)),
            child: Text(e.dotResponse, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          )
        ],
      ),
    );
  }

  Widget _buildAxleCard(AxleWeightReading a) {
    return Card(
      elevation: a.isWimFalsePositive ? 8 : 2,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: a.isWimFalsePositive ? Colors.orangeAccent : Colors.grey[300]!, width: a.isWimFalsePositive ? 2 : 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${a.axleGroup} Axles', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                Text('Limit: ${a.dotLimitLbs} lbs', style: TextStyle(color: Colors.grey[600], fontWeight: FontWeight.bold)),
              ],
            ),
            const Divider(height: 24),
            Row(
              children: [
                Expanded(
                  child: _buildWeightMetric('Highway WIM Sensor', a.highwayWimReadingLbs, a.dotLimitLbs, isDisputed: a.isWimFalsePositive),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: _buildWeightMetric('Onboard Telemetry', a.onboardTelemetryLbs, a.dotLimitLbs, isDisputed: false, isSourceOfTruth: true),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildWeightMetric(String label, int weightLbs, int limitLbs, {required bool isDisputed, bool isSourceOfTruth = false}) {
    bool isOverweight = weightLbs > limitLbs;
    Color valueColor = Colors.black87;
    
    if (isDisputed && isOverweight) valueColor = Colors.red;
    if (isSourceOfTruth) valueColor = Colors.green[700]!;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isDisputed ? Colors.orange[50] : (isSourceOfTruth ? Colors.green[50] : Colors.grey[50]),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(color: Colors.grey[700], fontSize: 12, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Row(
            children: [
              Text('$weightLbs', style: TextStyle(color: valueColor, fontSize: 24, fontWeight: FontWeight.bold)),
              Text(' lbs', style: TextStyle(color: valueColor, fontSize: 14)),
            ],
          ),
          if (isDisputed)
            const Text('FALSE POSITIVE', style: TextStyle(color: Colors.red, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1.1)),
          if (isSourceOfTruth)
             const Text('VERIFIED SAFE', style: TextStyle(color: Colors.green, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1.1))
        ],
      ),
    );
  }
}
