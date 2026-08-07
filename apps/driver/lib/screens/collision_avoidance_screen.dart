import 'package:flutter/material.dart';
import '../models/dock_proximity_model.dart';
import '../services/forklift_iot_service.dart';

class CollisionAvoidanceScreen extends StatefulWidget {
  const CollisionAvoidanceScreen({super.key});

  @override
  State<CollisionAvoidanceScreen> createState() => _CollisionAvoidanceScreenState();
}

class _CollisionAvoidanceScreenState extends State<CollisionAvoidanceScreen> {
  final ForkliftIotService _iotService = ForkliftIotService();
  List<IotTransponderSignal> _currentSignals = [];
  bool _isCritical = false;

  @override
  void initState() {
    super.initState();
    _startSimulation();
  }

  void _startSimulation() {
    _iotService.streamDockEnvironment().listen((signals) {
      if (mounted) {
        setState(() {
          _currentSignals = signals;
          _isCritical = signals.any((s) => s.isCriticalWarning);
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    Color bgColor = _isCritical ? Colors.red[900]! : Colors.grey[900]!;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dock Assist Radar'),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
      ),
      backgroundColor: bgColor,
      body: Column(
        children: [
          _buildRadarHeader(),
          Expanded(child: _buildRadarView()),
          _buildStatusPanel(),
        ],
      ),
    );
  }

  Widget _buildRadarHeader() {
    return Container(
      padding: const EdgeInsets.all(16),
      color: Colors.black45,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Text('TRUCK IN REVERSE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          Row(
            children: [
              Icon(Icons.wifi_tethering, color: Colors.greenAccent[400], size: 16),
              const SizedBox(width: 8),
              Text('IoT Dock Sync Active', style: TextStyle(color: Colors.greenAccent[400])),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildRadarView() {
    return Center(
      child: Container(
        width: 300,
        height: 300,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white30, width: 2),
          gradient: RadialGradient(
            colors: _isCritical 
                ? [Colors.red.withOpacity(0.8), Colors.transparent]
                : [Colors.green.withOpacity(0.3), Colors.transparent]
          )
        ),
        child: Stack(
          alignment: Alignment.center,
          children: [
            // Center Truck representation
            Container(width: 40, height: 80, decoration: BoxDecoration(color: Colors.blue[300], borderRadius: BorderRadius.circular(4))),
            const Positioned(bottom: 100, child: Text('FRONT', style: TextStyle(color: Colors.white54, fontSize: 10))),
            
            // Draw Signals
            ..._currentSignals.map((signal) {
               // Very rough positioning logic for mock
               double yOffset = signal.distanceMeters * 8; // Scale distance
               double xOffset = signal.angleDegrees * 2; 

               Color entityColor = signal.isCriticalWarning ? Colors.yellow : Colors.white;

               return Positioned(
                 top: 150 + yOffset, // Below center
                 left: 150 + xOffset,
                 child: Column(
                   children: [
                     Icon(
                       signal.entityType == 'Forklift' ? Icons.forklift : Icons.directions_walk,
                       color: entityColor,
                       size: signal.isCriticalWarning ? 32 : 24,
                     ),
                     if (signal.isCriticalWarning)
                        Text('${signal.distanceMeters.toStringAsFixed(1)}m', style: const TextStyle(color: Colors.yellow, fontWeight: FontWeight.bold, fontSize: 10))
                   ],
                 )
               );
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusPanel() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: const BoxDecoration(
        color: Colors.black87,
        borderRadius: BorderRadius.only(topLeft: Radius.circular(24), topRight: Radius.circular(24)),
      ),
      child: Column(
        children: [
          if (_isCritical) ...[
            const Icon(Icons.warning, color: Colors.yellow, size: 60),
            const SizedBox(height: 8),
            const Text('STOP IMMEDIATELY', style: TextStyle(color: Colors.yellow, fontSize: 28, fontWeight: FontWeight.bold, letterSpacing: 2)),
            const SizedBox(height: 8),
            const Text('Forklift approaching in right blind spot!', style: TextStyle(color: Colors.white, fontSize: 16)),
          ] else ...[
            const Icon(Icons.check_circle, color: Colors.green, size: 60),
            const SizedBox(height: 8),
            const Text('PATH CLEAR', style: TextStyle(color: Colors.green, fontSize: 28, fontWeight: FontWeight.bold, letterSpacing: 2)),
            const SizedBox(height: 8),
            const Text('Proceed backing slowly', style: TextStyle(color: Colors.white70, fontSize: 16)),
          ],
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: _startSimulation,
            icon: const Icon(Icons.replay),
            label: const Text('Restart Dock Simulation'),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.grey[800], foregroundColor: Colors.white),
          )
        ],
      ),
    );
  }
}
