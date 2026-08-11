import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/work_zone_delay_model.dart';
import '../services/work_zone_delay_service.dart';

class WorkZoneDelayScreen extends StatefulWidget {
  const WorkZoneDelayScreen({super.key});

  @override
  State<WorkZoneDelayScreen> createState() => _WorkZoneDelayScreenState();
}

class _WorkZoneDelayScreenState extends State<WorkZoneDelayScreen> {
  final WorkZoneDelayService _service = WorkZoneDelayService();
  WorkZoneRouteAnalysis? _analysis;

  @override
  void initState() {
    super.initState();
    _service.analysisStream.listen((data) {
      if (mounted) setState(() => _analysis = data);
    });
    _service.simulateDelayPrediction();
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
        title: const Text('DOT Work Zone Predictor'),
        backgroundColor: Colors.orange[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _analysis == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final a = _analysis!;
    
    return Column(
      children: [
        _buildDelayHeader(a),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (a.rerouteRecommended) _buildRerouteCard(a),
              if (a.rerouteRecommended) const SizedBox(height: 24),
              const Text('ACTIVE CONSTRUCTION ZONES', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (a.activeZones.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Center(child: Text('Scanning state DOT APIs for construction data...', style: TextStyle(color: Colors.grey))),
                )
              else
                ...a.activeZones.map((zone) => _buildZoneCard(zone)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildDelayHeader(WorkZoneRouteAnalysis a) {
    Color headerColor = Colors.green[700]!;
    if (a.totalPredictedDelayMinutes > 30) headerColor = Colors.orange[800]!;
    if (a.totalPredictedDelayMinutes > 90) headerColor = Colors.red[900]!;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 500),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: headerColor,
      child: Column(
        children: [
          const Icon(Icons.construction, color: Colors.white, size: 48),
          const SizedBox(height: 16),
          const Text('PREDICTED DELAY', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, letterSpacing: 2)),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text('${a.totalPredictedDelayMinutes}', style: const TextStyle(color: Colors.white, fontSize: 64, fontWeight: FontWeight.bold)),
              const Text(' MINS', style: TextStyle(color: Colors.white54, fontSize: 24, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 8),
          Text(a.routeId, style: const TextStyle(color: Colors.white, fontSize: 16)),
        ],
      ),
    );
  }

  Widget _buildRerouteCard(WorkZoneRouteAnalysis a) {
    return Card(
      elevation: 8,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: Colors.redAccent, width: 2)),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(color: Colors.red[50], borderRadius: BorderRadius.circular(16)),
        child: Column(
          children: [
            const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.alt_route, color: Colors.red, size: 32),
                SizedBox(width: 12),
                Text('REROUTE RECOMMENDED', style: TextStyle(color: Colors.red, fontSize: 20, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
              ],
            ),
            const SizedBox(height: 16),
            Text('A severe construction bottleneck will cause ${a.totalPredictedDelayMinutes} minutes of delay.', textAlign: TextAlign.center, style: TextStyle(color: Colors.red[900])),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              decoration: BoxDecoration(color: Colors.red[900], borderRadius: BorderRadius.circular(30)),
              child: Text('TAKE DETOUR (SAVE ${a.rerouteTimeSavingsMinutes} MINS)', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildZoneCard(WorkZoneEvent z) {
    bool isSevere = z.impactSeverity == 'Severe';
    
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isSevere ? Colors.redAccent : Colors.grey[300]!),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(z.highwaySegment, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: isSevere ? Colors.red[50] : Colors.orange[50], borderRadius: BorderRadius.circular(8)),
                  child: Text('+${z.predictedDelayMinutes} min', style: TextStyle(color: isSevere ? Colors.red : Colors.orange[900], fontWeight: FontWeight.bold)),
                )
              ],
            ),
            const SizedBox(height: 8),
            Text(z.constructionType, style: TextStyle(color: isSevere ? Colors.red : Colors.grey[800], fontWeight: isSevere ? FontWeight.bold : FontWeight.normal)),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildMetric('Impact', z.impactSeverity, isSevere ? Icons.warning : Icons.info, isSevere ? Colors.red : Colors.blue),
                _buildMetric('Est. Completion', DateFormat('MMM d').format(z.scheduledEnd), Icons.calendar_today, Colors.grey[700]!),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, IconData icon, Color color) {
    return Column(
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
