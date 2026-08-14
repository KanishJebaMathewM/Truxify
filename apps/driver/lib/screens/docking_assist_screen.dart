import 'package:flutter/material.dart';
import '../models/docking_assist_model.dart';
import '../services/docking_assist_service.dart';
import 'dart:math' as math;

class DockingAssistScreen extends StatefulWidget {
  const DockingAssistScreen({super.key});

  @override
  State<DockingAssistScreen> createState() => _DockingAssistScreenState();
}

class _DockingAssistScreenState extends State<DockingAssistScreen> {
  final DockingAssistService _service = DockingAssistService();
  DockingAssistSession? _session;

  @override
  void initState() {
    super.initState();
    _service.dockingStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateDockingManeuver();
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
        title: const Text('AR Backup Assistant'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[900], // Dark mode for cameras
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
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _buildDistanceCard(s.geometry.distanceToDockFeet, s.isDocked),
                const SizedBox(height: 24),
                Expanded(child: _buildSteeringAR(s.geometry, s.isDocked)),
              ],
            ),
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(DockingAssistSession s) {
    Color headerColor = s.isDocked ? Colors.green[800]! : (s.geometry.isAligned ? Colors.blue[800]! : Colors.orange[800]!);
    IconData icon = s.isDocked ? Icons.check_box : Icons.settings_backup_restore;

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
              Icon(icon, color: Colors.white, size: 32),
              const SizedBox(width: 12),
              Text(s.dockNumber, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 12),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildDistanceCard(double distance, bool isDocked) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 24),
      decoration: BoxDecoration(
        color: Colors.black45,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: isDocked ? Colors.green : Colors.grey[800]!),
      ),
      child: Column(
        children: [
          const Text('DISTANCE TO DOCK', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 2)),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(distance.toInt().toString(), style: TextStyle(color: isDocked ? Colors.green : Colors.white, fontSize: 64, fontWeight: FontWeight.bold)),
              const SizedBox(width: 8),
              const Text('ft', style: TextStyle(color: Colors.grey, fontSize: 24)),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildSteeringAR(DockingGeometry g, bool isDocked) {
    if (isDocked) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.local_shipping, color: Colors.green, size: 120),
            SizedBox(height: 16),
            Text('SET PARKING BRAKES', style: TextStyle(color: Colors.green, fontSize: 24, fontWeight: FontWeight.bold)),
          ],
        ),
      );
    }

    String guidanceText = '';
    IconData steerIcon = Icons.straight;
    Color arColor = g.isAligned ? Colors.blue : Colors.orange;

    if (g.requiredSteeringWheelAngle < -10) {
      guidanceText = 'TURN WHEEL LEFT';
      steerIcon = Icons.turn_left;
    } else if (g.requiredSteeringWheelAngle > 10) {
      guidanceText = 'TURN WHEEL RIGHT';
      steerIcon = Icons.turn_right;
    } else {
      guidanceText = 'HOLD STRAIGHT';
    }

    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(guidanceText, style: TextStyle(color: arColor, fontSize: 28, fontWeight: FontWeight.bold)),
        const SizedBox(height: 32),
        Stack(
          alignment: Alignment.center,
          children: [
            // Ghost wheel (target)
            Transform.rotate(
              angle: g.requiredSteeringWheelAngle * math.pi / 180,
              child: Icon(Icons.trip_origin, color: Colors.white24, size: 200),
            ),
            // Actual wheel position
            AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              child: Transform.rotate(
                angle: g.currentSteeringWheelAngle * math.pi / 180,
                child: Icon(Icons.radio_button_checked, color: arColor, size: 200),
              ),
            ),
            Icon(steerIcon, color: Colors.white, size: 48),
          ],
        ),
        const SizedBox(height: 32),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(24)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Trailer Angle: ${g.trailerAngleDegrees.toInt()}°', style: const TextStyle(color: Colors.white70)),
            ],
          ),
        )
      ],
    );
  }
}
