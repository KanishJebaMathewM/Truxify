import 'package:flutter/material.dart';
import '../models/yard_assignment_model.dart';
import '../services/yard_management_service.dart';

class YardNavigationScreen extends StatefulWidget {
  const YardNavigationScreen({super.key});

  @override
  State<YardNavigationScreen> createState() => _YardNavigationScreenState();
}

class _YardNavigationScreenState extends State<YardNavigationScreen> {
  final YardManagementService _ymsService = YardManagementService();
  YardAssignment? _currentAssignment;

  @override
  void initState() {
    super.initState();
    _startNavigation();
  }

  void _startNavigation() {
    _ymsService.streamYardNavigation('Amazon Fulfillment Center MDW7').listen((data) {
      if (mounted) {
        setState(() => _currentAssignment = data);
      }
    });
  }

  @override
  void dispose() {
    _ymsService.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Smart Yard Navigation'),
        backgroundColor: Colors.blue[900],
      ),
      backgroundColor: Colors.black87,
      body: _currentAssignment == null
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildHeaderCard(_currentAssignment!),
                Expanded(child: _buildRadarMap(_currentAssignment!)),
                _buildInstructionsCard(_currentAssignment!),
              ],
            ),
    );
  }

  Widget _buildHeaderCard(YardAssignment assignment) {
    bool isArrived = assignment.status == 'At Destination';

    return Container(
      width: double.infinity,
      color: isArrived ? Colors.green[800] : Colors.blue[900],
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Text(assignment.facilityName, style: const TextStyle(color: Colors.white70, fontSize: 16)),
          const SizedBox(height: 8),
          Text(isArrived ? 'ARRIVED AT' : 'NAVIGATING TO', style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold, letterSpacing: 2)),
          Text(assignment.targetId, style: const TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(20)),
            child: Text(
              assignment.assignmentType,
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildRadarMap(YardAssignment assignment) {
    bool isArrived = assignment.status == 'At Destination';

    return Stack(
      alignment: Alignment.center,
      children: [
        // Mock Grid Background
        Positioned.fill(
          child: CustomPaint(
            painter: _GridPainter(),
          ),
        ),
        // Destination Marker
        Positioned(
          top: 40,
          child: Column(
            children: [
              Icon(Icons.location_on, color: isArrived ? Colors.greenAccent : Colors.redAccent, size: 48),
              Text(assignment.targetId, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ],
          ),
        ),
        // Distance text
        if (!isArrived)
          Positioned(
            top: 150,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(color: Colors.blue[900], borderRadius: BorderRadius.circular(20)),
              child: Text('${assignment.distanceToTargetMeters.toInt()} meters', style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
            ),
          ),
        // Truck Marker moving up (mock movement using distance)
        Positioned(
          bottom: 40 + ((500 - assignment.distanceToTargetMeters) * 0.7), // Scale movement
          child: const Icon(Icons.local_shipping, color: Colors.white, size: 56),
        ),
      ],
    );
  }

  Widget _buildInstructionsCard(YardAssignment assignment) {
    bool isArrived = assignment.status == 'At Destination';

    return Container(
      color: Colors.white,
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('YARD INSTRUCTIONS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Row(
            children: [
              Icon(isArrived ? Icons.check_circle : Icons.turn_left, color: isArrived ? Colors.green : Colors.blue[900], size: 32),
              const SizedBox(width: 16),
              Expanded(
                child: Text(
                  isArrived ? 'Please safely back into the dock and check in with receiving.' : assignment.instructions,
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              )
            ],
          ),
          const SizedBox(height: 24),
          if (isArrived)
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Checked into dock.')));
                },
                style: ElevatedButton.styleFrom(backgroundColor: Colors.green[800], foregroundColor: Colors.white, padding: const EdgeInsets.all(16)),
                child: const Text('CONFIRM DOCKING', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            )
        ],
      ),
    );
  }
}

class _GridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white12
      ..strokeWidth = 1;
    
    for (double i = 0; i < size.width; i += 40) {
      canvas.drawLine(Offset(i, 0), Offset(i, size.height), paint);
    }
    for (double i = 0; i < size.height; i += 40) {
      canvas.drawLine(Offset(0, i), Offset(size.width, i), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
