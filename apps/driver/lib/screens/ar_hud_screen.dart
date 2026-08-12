import 'package:flutter/material.dart';
import '../models/ar_hud_model.dart';
import '../services/ar_hud_service.dart';

class ArHudScreen extends StatefulWidget {
  const ArHudScreen({super.key});

  @override
  State<ArHudScreen> createState() => _ArHudScreenState();
}

class _ArHudScreenState extends State<ArHudScreen> {
  final ArHudService _service = ArHudService();
  ArHudSession? _session;

  @override
  void initState() {
    super.initState();
    _service.hudStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateHighwayNavigation();
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black, // Dark background to simulate transparent glass HUD
      body: _session == null
          ? const Center(child: CircularProgressIndicator(color: Colors.cyan))
          : _buildHudOverlay(),
    );
  }

  Widget _buildHudOverlay() {
    final s = _session!;

    return Stack(
      children: [
        // Simulated Road background
        Positioned.fill(
          child: Opacity(
            opacity: 0.2,
            child: Image.network('https://images.unsplash.com/photo-1542282088-fe8426682b8f?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80', fit: BoxFit.cover),
          ),
        ),
        
        // AR Lane Projection
        Center(
          child: Padding(
            padding: const EdgeInsets.only(top: 200),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: s.lanes.map((l) => _buildLaneOverlay(l, s.isHazardHighlightActive)).toList(),
            ),
          ),
        ),

        // HUD Top Metrics
        Positioned(
          top: 60,
          left: 24,
          right: 24,
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildSpeedWidget(s.speedMph),
                  _buildNextTurnWidget(s.nextTurnDistanceMiles, s.nextTurnInstruction),
                ],
              ),
              const SizedBox(height: 24),
              Text(s.status.toUpperCase(), style: const TextStyle(color: Colors.cyanAccent, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 2.0)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSpeedWidget(double speed) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.black45,
        border: Border.all(color: Colors.cyanAccent.withOpacity(0.5), width: 1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Text(speed.toInt().toString(), style: const TextStyle(color: Colors.cyanAccent, fontSize: 48, fontWeight: FontWeight.bold, height: 1.0, fontFamily: 'monospace')),
          const Text('MPH', style: TextStyle(color: Colors.cyan, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 2)),
        ],
      ),
    );
  }

  Widget _buildNextTurnWidget(double distance, String instruction) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.black45,
        border: Border.all(color: Colors.cyanAccent.withOpacity(0.5), width: 1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Row(
            children: [
              const Icon(Icons.turn_right, color: Colors.cyanAccent, size: 36),
              const SizedBox(width: 12),
              Text('${distance.toStringAsFixed(1)} MI', style: const TextStyle(color: Colors.cyanAccent, fontSize: 32, fontWeight: FontWeight.bold, fontFamily: 'monospace')),
            ],
          ),
          const SizedBox(height: 8),
          Text(instruction.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold, letterSpacing: 1)),
        ],
      ),
    );
  }

  Widget _buildLaneOverlay(LaneDirective l, bool isFlashing) {
    Color baseColor = l.isTargetLane ? Colors.cyanAccent : Colors.white24;
    double width = l.isTargetLane ? 120.0 : 80.0;
    
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      margin: const EdgeInsets.symmetric(horizontal: 12),
      width: width,
      height: 300, // Simulated perspective
      child: Stack(
        alignment: Alignment.bottomCenter,
        children: [
          // Simulated AR perspective trapezoid
          Container(
            decoration: BoxDecoration(
              border: Border(
                left: BorderSide(color: baseColor, width: 2),
                right: BorderSide(color: baseColor, width: 2),
              ),
              gradient: LinearGradient(
                begin: Alignment.bottomCenter,
                end: Alignment.topCenter,
                colors: [baseColor.withOpacity(0.4), Colors.transparent],
              ),
            ),
          ),
          if (l.isTargetLane)
            Positioned(
              bottom: 40,
              child: Icon(Icons.keyboard_double_arrow_up, color: baseColor, size: 64),
            ),
          if (l.overlayText != null)
            Positioned(
              top: 40,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(color: baseColor, borderRadius: BorderRadius.circular(4)),
                child: Text(l.overlayText!, style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 16)),
              ),
            )
        ],
      ),
    );
  }
}
