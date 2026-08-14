import 'package:flutter/material.dart';

/// Flutter Impeller Fragment Shader Danger Radar Widget
class WeatherShaderOverlay extends StatefulWidget {
  final double dangerRadius;
  final Offset hazardCenter;

  const WeatherShaderOverlay({
    Key? key,
    this.dangerRadius = 0.2,
    this.hazardCenter = const Offset(0.5, 0.5),
  }) : super(key: key);

  @override
  State<WeatherShaderOverlay> createState() => _WeatherShaderOverlayState();
}

class _WeatherShaderOverlayState extends State<WeatherShaderOverlay>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
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
          painter: _RadarShaderPainter(
            time: _controller.value * 6.28,
            center: widget.hazardCenter,
            radius: widget.dangerRadius,
          ),
        );
      },
    );
  }
}

class _RadarShaderPainter extends CustomPainter {
  final double time;
  final Offset center;
  final double radius;

  _RadarShaderPainter({
    required this.time,
    required this.center,
    required this.radius,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0x66FF3D00)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.0;

    final centerPoint = Offset(size.width * center.dx, size.height * center.dy);
    final pulseRadius = (size.width * radius) * (0.5 + 0.5 * (time % 1.0));

    canvas.drawCircle(centerPoint, pulseRadius, paint);
  }

  @override
  bool shouldRepaint(covariant _RadarShaderPainter oldDelegate) => true;
}
