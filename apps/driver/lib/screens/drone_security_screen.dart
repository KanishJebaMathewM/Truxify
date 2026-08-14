import 'package:flutter/material.dart';
import '../models/drone_security_model.dart';
import '../services/drone_security_service.dart';

class DroneSecurityScreen extends StatefulWidget {
  const DroneSecurityScreen({super.key});

  @override
  State<DroneSecurityScreen> createState() => _DroneSecurityScreenState();
}

class _DroneSecurityScreenState extends State<DroneSecurityScreen> {
  final DroneSecurityService _service = DroneSecurityService();
  DroneSecuritySession? _session;

  @override
  void initState() {
    super.initState();
    _service.securityStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateSecurityPatrol();
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
        title: const Text('Autonomous Drone Sentry'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.black, // Dark mode for night vision aesthetic
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
              _buildCameraFeedMock(s),
              const SizedBox(height: 24),
              const Text('ACTIVE THREAT DETECTIONS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.activeThreats.isEmpty)
                const Card(
                  color: Colors.white10,
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: Text('Perimeter Secure', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold))),
                  ),
                )
              else
                ...s.activeThreats.map((t) => _buildThreatCard(t)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(DroneSecuritySession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isAlarmActive) {
      headerColor = Colors.red[900]!;
      icon = Icons.warning_amber_rounded;
    } else if (s.activeThreats.isNotEmpty) {
      headerColor = Colors.orange[800]!;
      icon = Icons.radar;
    } else {
      headerColor = Colors.green[900]!;
      icon = Icons.flight_takeoff;
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
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
              const Text('AERIAL PERIMETER SENTRY', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isAlarmActive) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildCameraFeedMock(DroneSecuritySession s) {
    bool isFlir = s.cameraMode.contains('FLIR');

    return Card(
      elevation: 8,
      color: Colors.black,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: s.isAlarmActive ? Colors.red : Colors.blueGrey[800]!, width: 2),
      ),
      child: Container(
        height: 200,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          gradient: LinearGradient(
            colors: isFlir 
                ? [Colors.blueGrey[900]!, Colors.black] // FLIR cold background
                : [Colors.grey[900]!, Colors.black],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          )
        ),
        child: Stack(
          children: [
            // Center reticle
            Center(
              child: Icon(Icons.add, size: 48, color: s.isAlarmActive ? Colors.red.withOpacity(0.5) : Colors.green.withOpacity(0.5)),
            ),
            // Threat overlays
            if (s.activeThreats.isNotEmpty)
              Positioned(
                top: 80,
                right: 80,
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    border: Border.all(color: s.isAlarmActive ? Colors.red : Colors.orange, width: 2),
                    color: s.isAlarmActive ? Colors.red.withOpacity(0.2) : Colors.orange.withOpacity(0.2),
                  ),
                  child: Text(isFlir ? 'HEAT SIGNATURE' : 'FACE RECORDED', style: TextStyle(color: s.isAlarmActive ? Colors.red : Colors.orange, fontWeight: FontWeight.bold, fontSize: 10)),
                ),
              ),
            // Telemetry overlay
            Positioned(
              top: 16,
              left: 16,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.cameraMode.toUpperCase(), style: const TextStyle(color: Colors.green, fontFamily: 'monospace', fontWeight: FontWeight.bold)),
                  Text('ALT: ${s.droneAltitudeFeet} FT', style: const TextStyle(color: Colors.green, fontFamily: 'monospace')),
                ],
              ),
            ),
            Positioned(
              bottom: 16,
              left: 16,
              child: Text(s.locationRisk, style: const TextStyle(color: Colors.redAccent, fontFamily: 'monospace', fontWeight: FontWeight.bold)),
            ),
            Positioned(
              bottom: 16,
              right: 16,
              child: Row(
                children: [
                  const Icon(Icons.battery_charging_full, color: Colors.green, size: 16),
                  const SizedBox(width: 4),
                  const Text('TETHER: 100%', style: TextStyle(color: Colors.green, fontFamily: 'monospace')),
                ],
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildThreatCard(SecurityThreat t) {
    bool isCritical = t.threatLevel == 'Critical';

    return Card(
      color: Colors.white10,
      elevation: isCritical ? 4 : 1,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isCritical ? Colors.red : Colors.orange, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(isCritical ? Icons.error_outline : Icons.person_search, color: isCritical ? Colors.red : Colors.orange),
                    const SizedBox(width: 12),
                    Text(t.objectType, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                Text(t.threatLevel.toUpperCase(), style: TextStyle(color: isCritical ? Colors.red : Colors.orange, fontWeight: FontWeight.bold, fontSize: 14)),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Distance to Trailer', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text('${t.distanceToTrailerFeet.toStringAsFixed(1)} FT', style: TextStyle(color: isCritical ? Colors.red : Colors.white, fontWeight: FontWeight.bold, fontSize: 20)),
                  ],
                ),
                Text('${t.detectionTime.hour}:${t.detectionTime.minute.toString().padLeft(2, '0')}:${t.detectionTime.second.toString().padLeft(2, '0')}', style: const TextStyle(color: Colors.grey, fontFamily: 'monospace')),
              ],
            )
          ],
        ),
      ),
    );
  }
}
