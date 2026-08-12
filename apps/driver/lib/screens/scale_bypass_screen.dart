import 'package:flutter/material.dart';
import '../models/scale_bypass_model.dart';
import '../services/scale_bypass_service.dart';

class ScaleBypassScreen extends StatefulWidget {
  const ScaleBypassScreen({super.key});

  @override
  State<ScaleBypassScreen> createState() => _ScaleBypassScreenState();
}

class _ScaleBypassScreenState extends State<ScaleBypassScreen> {
  final ScaleBypassService _service = ScaleBypassService();
  BypassSession? _session;

  @override
  void initState() {
    super.initState();
    _service.bypassStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateScaleApproach();
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
        title: const Text('Pre-Clearance Bypass'),
        backgroundColor: Colors.indigo[900],
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
              _buildStationInfo(s.station),
              const SizedBox(height: 24),
              const Text('WIM TELEMETRY TRANSMITTED', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildTelemetryRow('Gross Vehicle Weight', '${s.currentGrossWeightLbs.toInt()} lbs', Icons.scale, s.currentGrossWeightLbs <= 80000),
              const SizedBox(height: 8),
              _buildTelemetryRow('ISS Safety Score', '${s.safetyScoreIss}', Icons.security, s.safetyScoreIss < 50),
              const SizedBox(height: 8),
              _buildTelemetryRow('IFTA / IRP Credentials', 'Valid', Icons.verified_user, true),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(BypassSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isBypassGranted == true) {
      headerColor = Colors.green[700]!;
      icon = Icons.check_circle;
    } else if (s.isBypassGranted == false) {
      headerColor = Colors.red[700]!;
      icon = Icons.stop_circle;
    } else {
      headerColor = Colors.indigo[600]!;
      icon = Icons.radar;
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 500),
      width: double.infinity,
      padding: const EdgeInsets.all(32),
      color: headerColor,
      child: Column(
        children: [
          Icon(icon, color: Colors.white, size: 80),
          const SizedBox(height: 24),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildStationInfo(WeighStationInfo station) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.indigo[50], borderRadius: BorderRadius.circular(12)),
              child: Icon(Icons.account_balance, color: Colors.indigo[900], size: 32),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(station.stationName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  Text(station.highway, style: const TextStyle(color: Colors.grey)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTelemetryRow(String label, String value, IconData icon, bool isOk) {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: Icon(icon, color: isOk ? Colors.green : Colors.red),
        title: Text(label),
        trailing: Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: isOk ? Colors.black87 : Colors.red)),
      ),
    );
  }
}
