import 'package:flutter/material.dart';
import '../models/drone_trailer_locator_model.dart';
import '../services/drone_trailer_locator_service.dart';

class DroneTrailerLocatorScreen extends StatefulWidget {
  const DroneTrailerLocatorScreen({super.key});

  @override
  State<DroneTrailerLocatorScreen> createState() => _DroneTrailerLocatorScreenState();
}

class _DroneTrailerLocatorScreenState extends State<DroneTrailerLocatorScreen> {
  final DroneTrailerLocatorService _service = DroneTrailerLocatorService();
  DroneSession? _session;
  final String _targetId = 'AMZN-991823';
  bool _isDeployed = false;

  @override
  void initState() {
    super.initState();
    _service.droneStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  void _launchDrone() {
    setState(() => _isDeployed = true);
    _service.deployDrone(_targetId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('UAV Yard Locator'),
        backgroundColor: Colors.blueAccent[700],
      ),
      backgroundColor: Colors.grey[900], // Dark mode map aesthetic
      body: !_isDeployed 
          ? _buildPreLaunch()
          : _session == null
              ? const Center(child: CircularProgressIndicator())
              : _buildDashboard(),
    );
  }
  
  Widget _buildPreLaunch() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.flight_takeoff, color: Colors.blueAccent, size: 80),
          const SizedBox(height: 24),
          Text('Assigned Pick-up: $_targetId', style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 32),
          ElevatedButton.icon(
            onPressed: _launchDrone,
            icon: const Icon(Icons.radar),
            label: const Text('DEPLOY DRONE'),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.blueAccent,
              padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
            ),
          )
        ],
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
              _buildMapRadar(s),
              const SizedBox(height: 24),
              if (s.targetTrailer != null) _buildPinCard(s.targetTrailer!),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(DroneSession s) {
    bool isComplete = s.targetTrailer != null;
    Color headerColor = isComplete ? Colors.green[800]! : Colors.blueAccent[700]!;
    IconData icon = isComplete ? Icons.location_on : Icons.camera_alt;

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
              const Text('UAV ROOF SCANNER', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isAirborne) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildMapRadar(DroneSession s) {
    bool isComplete = s.targetTrailer != null;
    return Card(
      color: Colors.black,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: SizedBox(
        height: 200,
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                isComplete ? Icons.map : Icons.radar,
                color: isComplete ? Colors.green : Colors.blueAccent,
                size: 64,
              ),
              const SizedBox(height: 16),
              Text(
                isComplete ? 'Yard Mapping Complete' : 'Scanning Grid... (${s.trailersScanned} Trailers Checked)',
                style: const TextStyle(color: Colors.white70),
              )
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPinCard(TrailerLocation t) {
    return Card(
      color: Colors.grey[800],
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Colors.green, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.push_pin, color: Colors.green),
                SizedBox(width: 8),
                Text('TARGET ACQUIRED', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              ],
            ),
            const Divider(height: 32, color: Colors.white24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Trailer ID:', style: TextStyle(color: Colors.white70)),
                Text(t.trailerId, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Coordinates:', style: TextStyle(color: Colors.white70)),
                Text(t.yardZone, style: const TextStyle(color: Colors.yellow, fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Distance:', style: TextStyle(color: Colors.white70)),
                Text('${t.distanceFeet.toInt()} ft', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
