import 'package:flutter/material.dart';
import '../models/engine_brake_model.dart';
import '../services/engine_brake_service.dart';

class EngineBrakeScreen extends StatefulWidget {
  const EngineBrakeScreen({super.key});

  @override
  State<EngineBrakeScreen> createState() => _EngineBrakeScreenState();
}

class _EngineBrakeScreenState extends State<EngineBrakeScreen> {
  final EngineBrakeService _service = EngineBrakeService();
  EngineBrakeSession? _session;

  @override
  void initState() {
    super.initState();
    _service.brakeStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateGeofenceTransition();
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
        title: const Text('Geofenced ECM Logic'),
        backgroundColor: Colors.brown[900],
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
              _buildLocationCard(s.location, s.isRestrictedZone),
              const SizedBox(height: 24),
              const Text('ECM TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildEngineBrakeToggle(s.isEngineBrakeActive),
              const SizedBox(height: 24),
              if (s.fineAvoidedUsd > 0) _buildSavingsCard(s.fineAvoidedUsd),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(EngineBrakeSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isRestrictedZone && !s.isEngineBrakeActive) {
      headerColor = Colors.orange[800]!;
      icon = Icons.volume_off;
    } else if (s.isRestrictedZone && s.isEngineBrakeActive) {
      headerColor = Colors.red[800]!;
      icon = Icons.warning;
    } else {
      headerColor = Colors.green[800]!;
      icon = Icons.volume_up;
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
              const Text('NOISE ORDINANCE GEOFENCE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildLocationCard(String location, bool isRestricted) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: isRestricted ? Colors.orange[50] : Colors.green[50], borderRadius: BorderRadius.circular(12)),
              child: Icon(Icons.location_on, color: isRestricted ? Colors.orange[900] : Colors.green[900], size: 32),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(location, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  Text(isRestricted ? 'Restricted Zone' : 'Unrestricted', style: TextStyle(color: isRestricted ? Colors.orange[900] : Colors.green[900])),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEngineBrakeToggle(bool isActive) {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isActive ? Colors.green : Colors.grey, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('COMPRESSION BRAKE', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                Switch(
                  value: isActive,
                  onChanged: null, // Disabled because AI controls it
                  activeColor: Colors.green,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              isActive ? 'Enabled via ECM. Safe to use.' : 'OVERRIDDEN: Disabled via ECM to comply with local noise ordinance.',
              style: TextStyle(color: isActive ? Colors.grey : Colors.orange[900], fontSize: 12),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildSavingsCard(int savings) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Colors.green[50],
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.green, width: 2),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('LIABILITY AVOIDED', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                SizedBox(height: 4),
                Text('Municipal Fine Blocked', style: TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            Text('+\$${savings}', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 32, color: Colors.green[800])),
          ],
        ),
      ),
    );
  }
}
