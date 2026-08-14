import 'dart:math';
import 'package:flutter/material.dart';

/// 3D Cargo Load Visualizer Widget using CustomPainter & Touch Gestures
class Cargo3DVisualizer extends StatefulWidget {
  final double lengthMeters;
  final double widthMeters;
  final double heightMeters;

  const Cargo3DVisualizer({
    Key? key,
    required this.lengthMeters,
    required this.widthMeters,
    required this.heightMeters,
  }) : super(key: key);

  @override
  State<Cargo3DVisualizer> createState() => _Cargo3DVisualizerState();
}

class _Cargo3DVisualizerState extends State<Cargo3DVisualizer> {
  double _rotationX = 0.4;
  double _rotationY = 0.6;
  double _scale = 1.0;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onPanUpdate: (details) {
        setState(() {
          _rotationY += details.delta.dx * 0.01;
          _rotationX += details.delta.dy * 0.01;
        });
      },
      child: Container(
        height: 250,
        width: double.infinity,
        decoration: BoxDecoration(
          color: const Color(0xFF1E1E2C),
          borderRadius: BorderRadius.circular(12),
        ),
        child: CustomPaint(
          painter: _CargoBox3DPainter(
            rotationX: _rotationX,
            rotationY: _rotationY,
            scale: _scale,
            l: widget.lengthMeters,
            w: widget.widthMeters,
            h: widget.heightMeters,
          ),
        ),
      ),
    );
  }
}

class _CargoBox3DPainter extends CustomPainter {
  final double rotationX;
  final double rotationY;
  final double scale;
  final double l, w, h;

  _CargoBox3DPainter({
    required this.rotationX,
    required this.rotationY,
    required this.scale,
    required this.l,
    required this.w,
    required this.h,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final paintLine = Paint()
      ..color = const Color(0xFF00E676)
      ..strokeWidth = 2.0
      ..style = PaintingStyle.stroke;

    final paintFill = Paint()
      ..color = const Color(0x3300E676)
      ..style = PaintingStyle.fill;

    // Define 8 vertices of a 3D box
    final vertices = [
      _project(-l / 2, -w / 2, -h / 2, center),
      _project(l / 2, -w / 2, -h / 2, center),
      _project(l / 2, w / 2, -h / 2, center),
      _project(-l / 2, w / 2, -h / 2, center),
      _project(-l / 2, -w / 2, h / 2, center),
      _project(l / 2, -w / 2, h / 2, center),
      _project(l / 2, w / 2, h / 2, center),
      _project(-l / 2, w / 2, h / 2, center),
    ];

    // Draw box wireframe edges
    final path = Path();
    for (int i = 0; i < 4; i++) {
      path.moveTo(vertices[i].dx, vertices[i].dy);
      path.lineTo(vertices[(i + 1) % 4].dx, vertices[(i + 1) % 4].dy);

      path.moveTo(vertices[i + 4].dx, vertices[i + 4].dy);
      path.lineTo(vertices[((i + 1) % 4) + 4].dx, vertices[((i + 1) % 4) + 4].dy);

      path.moveTo(vertices[i].dx, vertices[i].dy);
      path.lineTo(vertices[i + 4].dx, vertices[i + 4].dy);
    }

    canvas.drawPath(path, paintLine);
    canvas.drawPath(path, paintFill);
  }

  Offset _project(double x, double y, double z, Offset center) {
    double radX = rotationX;
    double radY = rotationY;

    // Apply Y rotation
    double x1 = x * cos(radY) + z * sin(radY);
    double z1 = -x * sin(radY) + z * cos(radY);

    // Apply X rotation
    double y2 = y * cos(radX) - z1 * sin(radX);

    double zoom = 40.0 * scale;
    return Offset(center.dx + x1 * zoom, center.dy + y2 * zoom);
  }

  @override
  bool shouldRepaint(covariant _CargoBox3DPainter oldDelegate) => true;
}
