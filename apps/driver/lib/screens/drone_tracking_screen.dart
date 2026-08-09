import 'package:flutter/material.dart';
import '../models/drone_telemetry_model.dart';
import '../services/drone_handoff_service.dart';

class DroneTrackingScreen extends StatefulWidget {
  const DroneTrackingScreen({super.key});

  @override
  State<DroneTrackingScreen> createState() => _DroneTrackingScreenState();
}

class _DroneTrackingScreenState extends State<DroneTrackingScreen> {
  final DroneHandoffService _droneService = DroneHandoffService();
  DroneTelemetry? _currentTelemetry;

  @override
  void initState() {
    super.initState();
    _droneService.telemetryStream.listen((data) {
      if (mounted) {
        setState(() {
          _currentTelemetry = data;
        });
      }
    });
  }

  @override
  void dispose() {
    _droneService.dispose();
    super.dispose();
  }

  void _deployDrone() {
    _droneService.startMockMission();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Drone deployed. Calculating moving rendezvous coordinates...'))
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Drone Intercept Radar'),
        backgroundColor: Colors.cyan[900],
      ),
      backgroundColor: Colors.black87,
      body: Center(
        child: _currentTelemetry == null
            ? _buildIdleState()
            : _buildActiveMissionState(),
      ),
      floatingActionButton: _currentTelemetry == null || _currentTelemetry!.status == 'Docked'
          ? FloatingActionButton.extended(
              onPressed: _deployDrone,
              backgroundColor: Colors.cyanAccent[700],
              icon: const Icon(Icons.flight_takeoff, color: Colors.black),
              label: const Text('DEPLOY DRONE', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
            )
          : null,
    );
  }

  Widget _buildIdleState() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(Icons.flight_land, size: 120, color: Colors.cyan[900]),
        const SizedBox(height: 24),
        const Text('AeroX-12 Drone is Docked', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        const Text('Ready for rural last-mile deployment.', style: TextStyle(color: Colors.grey)),
      ],
    );
  }

  Widget _buildActiveMissionState() {
    final t = _currentTelemetry!;
    final isDocked = t.status == 'Docked';

    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        children: [
          _buildRadarAnimation(isDocked),
          const SizedBox(height: 48),
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.grey[900],
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: Colors.cyan[900]!, width: 2),
            ),
            child: Column(
              children: [
                Text(t.status, style: TextStyle(color: isDocked ? Colors.greenAccent : Colors.cyanAccent, fontSize: 20, fontWeight: FontWeight.bold)),
                const Divider(color: Colors.white24, height: 32),
                _buildDataRow(Icons.timer, 'Intercept In', '${t.timeToRendezvousSec} seconds'),
                const SizedBox(height: 16),
                _buildDataRow(Icons.straighten, 'Distance', '${t.distanceToTruck.toStringAsFixed(1)} meters'),
                const SizedBox(height: 16),
                _buildDataRow(Icons.my_location, 'Intercept GPS', t.predictedRendezvousGps),
                const SizedBox(height: 16),
                _buildDataRow(Icons.battery_charging_full, 'Drone Battery', '${t.batteryPercent}%'),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildRadarAnimation(bool isDocked) {
    return Container(
      width: 250,
      height: 250,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: isDocked ? Colors.green : Colors.cyan, width: 2),
        color: (isDocked ? Colors.green : Colors.cyan).withOpacity(0.1),
      ),
      child: Center(
        child: Icon(
          isDocked ? Icons.check_circle : Icons.wifi_tethering,
          size: 80,
          color: isDocked ? Colors.greenAccent : Colors.cyanAccent,
        ),
      ),
    );
  }

  Widget _buildDataRow(IconData icon, String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Row(
          children: [
            Icon(icon, color: Colors.grey, size: 20),
            const SizedBox(width: 8),
            Text(label, style: const TextStyle(color: Colors.grey, fontSize: 16)),
          ],
        ),
        Text(value, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, fontFamily: 'monospace')),
      ],
    );
  }
}
