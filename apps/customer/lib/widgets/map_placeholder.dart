import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class MapPlaceholder extends StatelessWidget {
  const MapPlaceholder({
    super.key,
    required this.progress,
    required this.pickup,
    required this.drop,
    required this.currentLocation,
  });

  final double progress;
  final String pickup;
  final String drop;
  final String currentLocation;
  Offset _calculateTruckPosition(BoxConstraints constraints) {
    final x = constraints.maxWidth * (0.18 + (0.60 * progress));
    final y = constraints.maxHeight * (0.64 - 0.18 * math.sin(progress * math.pi));
    return Offset(x, y);
  }
  
  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: Stack(
        children: [
          Positioned.fill(
            child: CustomPaint(
              painter: _MapGridPainter(),
              child: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      Colors.grey.shade300,
                      Colors.grey.shade200,
                      Colors.grey.shade300,
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
              ),
            ),
          ),
          Positioned.fill(
            child: CustomPaint(
              painter: _RoutePainter(progress: progress),
            ),
          ),
          Positioned(
            left: 18,
            top: 18,
            child: _MapPin(label: pickup, color: TruxifyColors.accentDark, icon: Icons.my_location_rounded),
          ),
          Positioned(
            right: 18,
            bottom: 96,
            child: _MapPin(label: drop, color: TruxifyColors.warning, icon: Icons.place_rounded),
          ),
          Positioned.fill(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final position = _calculateTruckPosition(constraints);

                return Stack(
                  children: [
                    Positioned(
                      left: position.dx - 20,
                      top: position.dy - 20,
                      child: Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          color: TruxifyColors.accent,
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: TruxifyColors.accent.withValues(alpha: 0.25),
                              blurRadius: 18,
                              spreadRadius: 2,
                            ),
                          ],
                        ),
                        child: const Center(
                          child: Text('🚛', style: TextStyle(fontSize: 22)),
                        ),
                      ),
                    ),
                    Positioned(
                      left: 18,
                      right: 18,
                      bottom: 18,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.88),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: Colors.white.withValues(alpha: 0.6)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.gps_fixed_rounded, color: TruxifyColors.accentDark, size: 18),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                currentLocation,
                                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                      fontWeight: FontWeight.w700,
                                    ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _MapPin extends StatelessWidget {
  const _MapPin({required this.label, required this.color, required this.icon});

  final String label;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: 0.75)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 8),
          Text(label, style: Theme.of(context).textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

class _MapGridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final gridPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.2)
      ..strokeWidth = 1;

    for (double x = 0; x <= size.width; x += 34) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), gridPaint);
    }
    for (double y = 0; y <= size.height; y += 34) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _RoutePainter extends CustomPainter {
  _RoutePainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final pathPaint = Paint()
      ..color = TruxifyColors.accentDark.withValues(alpha: 0.28)
      ..strokeWidth = 4
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final path = Path()
      ..moveTo(size.width * 0.16, size.height * 0.64)
      ..quadraticBezierTo(size.width * 0.42, size.height * 0.40, size.width * 0.84, size.height * 0.52);
    canvas.drawPath(path, pathPaint);

    final dashPaint = Paint()
      ..color = TruxifyColors.accent.withValues(alpha: 0.55)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;

    final dashPath = Path()
      ..moveTo(size.width * 0.16, size.height * 0.64)
      ..quadraticBezierTo(size.width * 0.42, size.height * 0.40, size.width * 0.84, size.height * 0.52);
    for (final metric in dashPath.computeMetrics()) {
      double distance = 0;
      while (distance < metric.length * progress) {
        final segment = metric.extractPath(distance, math.min(distance + 16, metric.length * progress));
        canvas.drawPath(segment, dashPaint);
        distance += 24;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _RoutePainter oldDelegate) => oldDelegate.progress != progress;
}
