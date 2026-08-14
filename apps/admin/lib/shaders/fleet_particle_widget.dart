import 'package:flutter/material.dart';

/// Flutter Impeller Compute Pipeline Integration Widget
class FleetParticleWidget extends StatefulWidget {
  final int particleCount;

  const FleetParticleWidget({
    Key? key,
    this.particleCount = 1000,
  }) : super(key: key);

  @override
  State<FleetParticleWidget> createState() => _FleetParticleWidgetState();
}

class _FleetParticleWidgetState extends State<FleetParticleWidget>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 10),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return CustomPaint(
          size: Size.infinite,
          painter: _FleetGPUComputePainter(
            timeStep: 0.016, // 60 FPS delta
            count: widget.particleCount,
          ),
        );
      },
    );
  }
}

class _FleetGPUComputePainter extends CustomPainter {
  final double timeStep;
  final int count;

  _FleetGPUComputePainter({required this.timeStep, required this.count});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFF00E676)
      ..strokeWidth = 2.0;

    // Simulated compute pipeline particle coordinates
    for (int i = 0; i < count; i++) {
      double x = (size.width * 0.15) + (i * 17.5) % (size.width * 0.7);
      double y = (size.height * 0.25) + (i * 29.3) % (size.height * 0.5);
      canvas.drawCircle(Offset(x, y), 2.0, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _FleetGPUComputePainter oldDelegate) => true;
}
