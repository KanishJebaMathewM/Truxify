import 'package:flutter/material.dart';
import '../models/tpms_analytics_model.dart';
import '../services/tpms_telemetry_service.dart';

class PredictiveTireWearScreen extends StatefulWidget {
  const PredictiveTireWearScreen({super.key});

  @override
  State<PredictiveTireWearScreen> createState() => _PredictiveTireWearScreenState();
}

class _PredictiveTireWearScreenState extends State<PredictiveTireWearScreen> {
  final TpmsTelemetryService _telemetryService = TpmsTelemetryService();
  TruckTpmsState? _currentState;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _startTelemetry();
  }

  void _startTelemetry() {
    _telemetryService.streamTireData().listen((state) {
      if (mounted) {
        setState(() {
          _currentState = state;
          _isLoading = false;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    bool hasCritical = _currentState?.tires.any((t) => t.isCritical) ?? false;

    return Scaffold(
      appBar: AppBar(
        title: const Text('TPMS & Wear Analytics'),
        backgroundColor: hasCritical ? Colors.red[900] : Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildStatusBanner(),
                Expanded(child: _buildTireGrid()),
              ],
            ),
    );
  }

  Widget _buildStatusBanner() {
    final s = _currentState!;
    bool isDanger = s.overallStatus == 'ANOMALY DETECTED';
    
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isDanger ? Colors.red[900] : Colors.blueGrey[800],
      child: Column(
        children: [
          Icon(isDanger ? Icons.warning_amber_rounded : Icons.check_circle_outline, color: Colors.white, size: 48),
          const SizedBox(height: 12),
          Text(s.overallStatus, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 2)),
          if (isDanger) ...[
            const SizedBox(height: 8),
            const Text('High blowout risk on Drive R Outer. Pull over immediately.', style: TextStyle(color: Colors.white70, fontSize: 16), textAlign: TextAlign.center),
          ]
        ],
      ),
    );
  }

  Widget _buildTireGrid() {
    return GridView.builder(
      padding: const EdgeInsets.all(16),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 0.75,
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
      ),
      itemCount: _currentState!.tires.length,
      itemBuilder: (context, index) {
        return _buildTireCard(_currentState!.tires[index]);
      },
    );
  }

  Widget _buildTireCard(TireTelemetry tire) {
    Color statusColor;
    if (tire.isCritical) statusColor = Colors.red[700]!;
    else if (tire.isWarning) statusColor = Colors.orange[700]!;
    else statusColor = Colors.green[700]!;

    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: tire.isCritical ? Colors.red : Colors.transparent, width: 3)
      ),
      elevation: tire.isCritical ? 8 : 2,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(tire.tirePosition, style: const TextStyle(fontWeight: FontWeight.bold)),
                Icon(Icons.tire_repair, color: statusColor, size: 20),
              ],
            ),
            const Divider(),
            const Spacer(),
            Center(
              child: Stack(
                alignment: Alignment.center,
                children: [
                  SizedBox(
                    width: 70, height: 70,
                    child: CircularProgressIndicator(
                      value: tire.currentPressurePsi / tire.targetPressurePsi,
                      backgroundColor: Colors.grey[200],
                      color: statusColor,
                      strokeWidth: 8,
                    ),
                  ),
                  Text('${tire.currentPressurePsi.toInt()}', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: statusColor)),
                ],
              ),
            ),
            const Spacer(),
            const Center(child: Text('PSI', style: TextStyle(color: Colors.grey, fontSize: 12))),
            const Divider(),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Temp:', style: TextStyle(color: Colors.grey, fontSize: 12)),
                Text('${tire.temperatureFahrenheit.toInt()}°F', style: TextStyle(fontWeight: FontWeight.bold, color: tire.temperatureFahrenheit > 140 ? Colors.red : Colors.black)),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Wear:', style: TextStyle(color: Colors.grey, fontSize: 12)),
                Text('${tire.treadWearPredictionPct.toInt()}%', style: TextStyle(fontWeight: FontWeight.bold, color: tire.treadWearPredictionPct > 85 ? Colors.red : Colors.black)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
