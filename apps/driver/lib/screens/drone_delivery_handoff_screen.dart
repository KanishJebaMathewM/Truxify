import 'package:flutter/material.dart';
import '../models/drone_delivery_handoff_model.dart';
import '../services/drone_delivery_handoff_service.dart';

class DroneDeliveryHandoffScreen extends StatefulWidget {
  const DroneDeliveryHandoffScreen({super.key});

  @override
  State<DroneDeliveryHandoffScreen> createState() => _DroneDeliveryHandoffScreenState();
}

class _DroneDeliveryHandoffScreenState extends State<DroneDeliveryHandoffScreen> {
  final DroneDeliveryHandoffService _service = DroneDeliveryHandoffService();
  DroneMission? _mission;
  bool _missionStarted = false;

  @override
  void initState() {
    super.initState();
    _service.missionStream.listen((data) {
      if (mounted) setState(() => _mission = data);
    });
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }
  
  void _startMission() {
    setState(() => _missionStarted = true);
    _service.simulateDeliveryMission();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Autonomous Drone Handoff'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: !_missionStarted 
          ? _buildSetupState()
          : (_mission == null ? const Center(child: CircularProgressIndicator()) : _buildMissionDashboard()),
    );
  }

  Widget _buildSetupState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.flight_takeoff, size: 80, color: Colors.blueGrey[400]),
            const SizedBox(height: 16),
            const Text('Final Mile Drone Staging', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('Load the parcel into the roof-mounted drone and secure the payload bay.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton.icon(
                onPressed: _startMission,
                icon: const Icon(Icons.rocket_launch),
                label: const Text('LAUNCH DRONE', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.blueGrey[900], foregroundColor: Colors.white),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMissionDashboard() {
    final m = _mission!;
    Color statusColor = Colors.blue;
    if (m.status.contains('Delivered')) statusColor = Colors.green;
    if (m.status.contains('Returning')) statusColor = Colors.orange;

    return Column(
      children: [
        _buildDroneCameraFeed(m, statusColor),
        Expanded(
          child: Container(
            padding: const EdgeInsets.all(24),
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Mission ${m.missionId}', style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      decoration: BoxDecoration(color: statusColor.withOpacity(0.1), borderRadius: BorderRadius.circular(12)),
                      child: Text(m.status, style: TextStyle(color: statusColor, fontWeight: FontWeight.bold)),
                    )
                  ],
                ),
                const SizedBox(height: 24),
                _buildDeliveryInfo(m),
                const Divider(height: 48),
                _buildTelemetryGrid(m),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildDroneCameraFeed(DroneMission m, Color statusColor) {
    return Container(
      height: 250,
      width: double.infinity,
      color: Colors.black,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Icon(Icons.video_camera_back, size: 80, color: Colors.white12),
          Positioned(
            top: 16,
            left: 16,
            child: Row(
              children: [
                const Icon(Icons.circle, color: Colors.redAccent, size: 12),
                const SizedBox(width: 8),
                Text('LIVE • ${m.droneId}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              ],
            ),
          ),
          Positioned(
            bottom: 16,
            left: 16,
            child: Text(m.status.toUpperCase(), style: TextStyle(color: statusColor, fontSize: 24, fontWeight: FontWeight.bold)),
          ),
           Positioned(
            bottom: 16,
            right: 16,
            child: Text('${m.distanceMiles.toStringAsFixed(1)} MI', style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
          )
        ],
      ),
    );
  }

  Widget _buildDeliveryInfo(DroneMission m) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: Colors.blueGrey[50], shape: BoxShape.circle),
          child: Icon(Icons.person_pin_circle, color: Colors.blueGrey[900]),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(m.recipientName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              Text(m.deliveryAddress, style: const TextStyle(color: Colors.grey)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildTelemetryGrid(DroneMission m) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceAround,
      children: [
        _buildMetric('Payload', '${m.payloadWeightLbs} lbs', Icons.scale),
        _buildMetric('ETA', '${m.estimatedMinutes} min', Icons.timer),
        _buildMetric('Battery', '${m.batteryPercentage.toInt()}%', Icons.battery_charging_full),
      ],
    );
  }

  Widget _buildMetric(String label, String value, IconData icon) {
    return Column(
      children: [
        Icon(icon, color: Colors.blueGrey[300]),
        const SizedBox(height: 8),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
