import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/parking_probability_model.dart';
import '../services/parking_probability_service.dart';

class ParkingProbabilityScreen extends StatefulWidget {
  const ParkingProbabilityScreen({super.key});

  @override
  State<ParkingProbabilityScreen> createState() => _ParkingProbabilityScreenState();
}

class _ParkingProbabilityScreenState extends State<ParkingProbabilityScreen> {
  final ParkingProbabilityService _service = ParkingProbabilityService();
  ParkingEngineSession? _session;

  @override
  void initState() {
    super.initState();
    _service.engineStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeEngine();
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
        title: const Text('Parking Probability Engine'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isAnalyzing == true ? null : () => _service.runTelemetryAnalysis(),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.radar),
        label: const Text('Scan Upcoming Rest Stops'),
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
              if (s.upcomingStops.isNotEmpty) ...[
                const Text('UPCOMING TRUCK STOPS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                ...s.upcomingStops.map((stop) => _buildStopCard(stop)),
              ] else ...[
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('Tap Scan to analyze crowdsourced GPS telemetry.', style: TextStyle(color: Colors.grey)),
                ))
              ],
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(ParkingEngineSession s) {
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
                : const Icon(Icons.local_parking, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('CROWDSOURCED TELEMETRY', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildStopCard(RestStop stop) {
    Color statusColor = Colors.grey;
    if (stop.status == 'High Chance') {
      statusColor = Colors.green;
    } else if (stop.status == 'Risky') {
      statusColor = Colors.orange;
    } else {
      statusColor = Colors.red;
    }

    return Card(
      elevation: 2,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: statusColor.withOpacity(0.5), width: 2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(stop.stopName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      Text(stop.highwayLocation, style: const TextStyle(color: Colors.grey, fontSize: 12)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(color: statusColor, borderRadius: BorderRadius.circular(16)),
                  child: Text('${stop.probabilityScore.toStringAsFixed(1)}%', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                )
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('Distance', '${stop.distanceMiles} mi', Colors.indigo),
                _buildMetric('Est. Arrival', '+${stop.estimatedArrivalMinutes} min', Colors.blueGrey),
                _buildMetric('Capacity', '${stop.estimatedCurrentOccupancy}/${stop.totalCapacity}', statusColor),
              ],
            ),
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: statusColor.withOpacity(0.1), borderRadius: BorderRadius.circular(4)),
              child: Text(
                'STATUS: ${stop.status.toUpperCase()}',
                textAlign: TextAlign.center,
                style: TextStyle(color: statusColor, fontWeight: FontWeight.bold, fontSize: 12, letterSpacing: 1.0),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: color)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 10)),
      ],
    );
  }
}
