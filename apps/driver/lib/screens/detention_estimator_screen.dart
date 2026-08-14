import 'package:flutter/material.dart';
import '../models/detention_estimator_model.dart';
import '../services/detention_estimator_service.dart';

class DetentionEstimatorScreen extends StatefulWidget {
  const DetentionEstimatorScreen({super.key});

  @override
  State<DetentionEstimatorScreen> createState() => _DetentionEstimatorScreenState();
}

class _DetentionEstimatorScreenState extends State<DetentionEstimatorScreen> {
  final DetentionEstimatorService _service = DetentionEstimatorService();
  DetentionEstimatorSession? _session;

  @override
  void initState() {
    super.initState();
    _service.detentionStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.analyzeGeofenceData();
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
        title: const Text('Facility Detention Estimator'),
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
              const Text('WAREHOUSE INTELLIGENCE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.facilities.isEmpty)
                const Center(child: CircularProgressIndicator())
              else
                ...s.facilities.map((facility) => _buildFacilityCard(facility)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(DetentionEstimatorSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: Colors.indigo[800],
      child: Column(
        children: [
          const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.radar, color: Colors.white, size: 36),
              SizedBox(width: 12),
              Text('GEOFENCE AGGREGATOR', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildFacilityCard(FacilityDetentionStats f) {
    bool isWarning = f.averageWaitHours > 3.0;
    bool isCritical = f.averageWaitHours > 5.0;

    Color badgeColor = isCritical ? Colors.red : (isWarning ? Colors.orange : Colors.green);
    IconData badgeIcon = isCritical ? Icons.warning : (isWarning ? Icons.access_time : Icons.check_circle);

    return Card(
      elevation: isCritical ? 4 : 1,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: badgeColor, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(f.facilityName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                      const SizedBox(height: 4),
                      Text(f.location, style: const TextStyle(color: Colors.grey, fontSize: 14)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(color: badgeColor.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                  child: Column(
                    children: [
                      Icon(badgeIcon, color: badgeColor, size: 24),
                      const SizedBox(height: 4),
                      Text('${f.averageWaitHours}h', style: TextStyle(color: badgeColor, fontWeight: FontWeight.bold, fontSize: 18)),
                    ],
                  ),
                )
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.group, color: Colors.blueGrey, size: 16),
                    const SizedBox(width: 8),
                    Text('Based on ${f.totalGeofenceVisits} visits', style: const TextStyle(color: Colors.blueGrey, fontSize: 12)),
                  ],
                ),
                Row(
                  children: [
                    Text('Trend: ${f.trend}', style: TextStyle(color: f.trend == 'Worsening' ? Colors.red : (f.trend == 'Improving' ? Colors.green : Colors.orange), fontSize: 12, fontWeight: FontWeight.bold)),
                  ],
                ),
              ],
            )
          ],
        ),
      ),
    );
  }
}
