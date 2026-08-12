import 'package:flutter/material.dart';
import '../models/tpms_predictive_model.dart';
import '../services/tpms_predictive_service.dart';

class TpmsPredictiveScreen extends StatefulWidget {
  const TpmsPredictiveScreen({super.key});

  @override
  State<TpmsPredictiveScreen> createState() => _TpmsPredictiveScreenState();
}

class _TpmsPredictiveScreenState extends State<TpmsPredictiveScreen> {
  final TpmsPredictiveService _service = TpmsPredictiveService();
  TpmsSession? _session;

  @override
  void initState() {
    super.initState();
    _service.tpmsStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateHighwayDriving();
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
        title: const Text('Predictive TPMS AI'),
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
              ...s.tires.map((tire) => _buildTireCard(tire)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(TpmsSession s) {
    Color headerColor = s.hasCriticalAlert ? Colors.red[800]! : Colors.blueGrey[800]!;
    IconData icon = s.hasCriticalAlert ? Icons.warning : Icons.tire_repair;

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
              const Text('THERMODYNAMIC TELEMETRY', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (!s.hasCriticalAlert) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildTireCard(TireData t) {
    bool isWarning = t.isLeaking;
    bool isCritical = t.milesToCriticalFailure < 50;

    Color borderColor = Colors.grey[300]!;
    if (isCritical) borderColor = Colors.red;
    else if (isWarning) borderColor = Colors.orange;

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      elevation: isCritical ? 8 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: borderColor, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t.position, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                      const SizedBox(height: 4),
                      if (isCritical)
                        const Text('CRITICAL BLOWOUT RISK', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 12))
                      else if (isWarning)
                        const Text('SLOW LEAK DETECTED', style: TextStyle(color: Colors.orange, fontWeight: FontWeight.bold, fontSize: 12))
                      else
                        const Text('Optimal Range', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold, fontSize: 12)),
                    ],
                  ),
                ),
                Icon(Icons.trip_origin, size: 48, color: isCritical ? Colors.red : (isWarning ? Colors.orange : Colors.blueGrey)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildTelemetryStat('${t.currentPsi.toInt()}', 'PSI', isCritical ? Colors.red : Colors.black87),
                Container(height: 40, width: 1, color: Colors.grey[300]),
                _buildTelemetryStat('${t.tempFahrenheit.toInt()}°', 'Temp (F)', isCritical ? Colors.red : Colors.black87),
                Container(height: 40, width: 1, color: Colors.grey[300]),
                _buildTelemetryStat(isWarning ? '-${t.pressureLossRatePerHour} / hr' : 'Stable', 'Loss Rate', isWarning ? Colors.orange : Colors.green),
              ],
            ),
            if (isWarning) ...[
              const SizedBox(height: 24),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: isCritical ? Colors.red[50] : Colors.orange[50], borderRadius: BorderRadius.circular(12)),
                child: Column(
                  children: [
                    Text('PREDICTED FAILURE IN:', style: TextStyle(color: isCritical ? Colors.red[900] : Colors.orange[900], fontSize: 12, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('${t.milesToCriticalFailure} Miles', style: TextStyle(color: isCritical ? Colors.red : Colors.orange, fontSize: 24, fontWeight: FontWeight.bold)),
                  ],
                ),
              )
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildTelemetryStat(String value, String label, Color valueColor) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: valueColor)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
