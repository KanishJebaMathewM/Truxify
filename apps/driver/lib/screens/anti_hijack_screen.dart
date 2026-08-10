import 'package:flutter/material.dart';
import '../models/anti_hijack_model.dart';
import '../services/anti_hijack_service.dart';

class AntiHijackScreen extends StatefulWidget {
  const AntiHijackScreen({super.key});

  @override
  State<AntiHijackScreen> createState() => _AntiHijackScreenState();
}

class _AntiHijackScreenState extends State<AntiHijackScreen> {
  final AntiHijackService _service = AntiHijackService();
  AntiHijackSession? _session;

  @override
  void initState() {
    super.initState();
    _service.securityStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateHijackAttempt();
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
        title: const Text('Anti-Hijacking Security'),
        backgroundColor: Colors.black,
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
              _buildLoadCard(s),
              const SizedBox(height: 24),
              const Text('PHYSICAL SECURITY TELEMETRY', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildTelemetryList(s.telemetry),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(AntiHijackSession s) {
    Color headerColor = Colors.green[800]!;
    IconData icon = Icons.security;
    
    if (s.status.contains('Unauthorized')) {
      headerColor = Colors.orange[800]!;
      icon = Icons.warning_amber_rounded;
    } else if (s.status.contains('IMMOBILIZED')) {
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
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('DEFENDER PROTOCOL', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 2)),
            ],
          ),
          const SizedBox(height: 24),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildLoadCard(AntiHijackSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('PROTECTED ASSET', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 12),
            Text(s.cargoType, style: const TextStyle(color: Colors.black87, fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Text('Load ID: ${s.loadId}', style: const TextStyle(color: Colors.grey, fontSize: 14)),
          ],
        ),
      ),
    );
  }

  Widget _buildTelemetryList(SecurityTelemetry t) {
    return Column(
      children: [
        _buildSensorRow(
          'Engine Ignition',
          t.engineStarted ? 'STARTED' : 'OFF',
          t.engineStarted ? Icons.power_settings_new : Icons.power_off,
          t.engineStarted && !t.isDriverAuthorized ? Colors.red : Colors.grey[700]!,
        ),
        _buildSensorRow(
          'Driver Authorization',
          t.isDriverAuthorized ? 'VERIFIED' : 'FAILED / UNAVAILABLE',
          t.isDriverAuthorized ? Icons.fingerprint : Icons.no_accounts,
          !t.isDriverAuthorized && t.engineStarted ? Colors.red : Colors.grey[700]!,
        ),
        _buildSensorRow(
          'Geofence Boundary',
          t.geofenceBreached ? 'BREACHED' : 'SECURE',
          t.geofenceBreached ? Icons.gps_off : Icons.gps_fixed,
          t.geofenceBreached ? Colors.red : Colors.green[700]!,
        ),
        const SizedBox(height: 12),
        const Divider(),
        const SizedBox(height: 12),
        _buildSensorRow(
          'Trailer Air Brakes',
          t.trailerBrakeStatus,
          Icons.air,
          t.trailerBrakeStatus.contains('Locked') ? Colors.red[900]! : Colors.orange[700]!,
        ),
        _buildSensorRow(
          '5th Wheel Kingpin',
          t.kingpinStatus,
          t.kingpinStatus.contains('Deadbolt') ? Icons.lock : Icons.lock_open,
          t.kingpinStatus.contains('Deadbolt') ? Colors.red[900]! : Colors.grey[700]!,
        ),
      ],
    );
  }

  Widget _buildSensorRow(String label, String value, IconData icon, Color statusColor) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8), side: BorderSide(color: Colors.grey[300]!)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Icon(icon, color: statusColor),
            const SizedBox(width: 16),
            Expanded(
              child: Text(label, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: statusColor.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
              child: Text(value, style: TextStyle(color: statusColor, fontWeight: FontWeight.bold, fontSize: 12)),
            )
          ],
        ),
      ),
    );
  }
}
