import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class PulsingLocationDot extends StatefulWidget {
  const PulsingLocationDot({
    super.key,
    this.size = 10,
    this.duration = const Duration(seconds: 2),
    this.isActive = true,
  });

  final double size;
  final Duration duration;
  final bool isActive;

  @override
  State<PulsingLocationDot> createState() => _PulsingLocationDotState();
}

class _PulsingLocationDotState extends State<PulsingLocationDot>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: widget.duration,
    );

    if (widget.isActive) {
      _controller.repeat();
    }
  }

  @override
  void didUpdateWidget(covariant PulsingLocationDot oldWidget) {
    super.didUpdateWidget(oldWidget);

    if (oldWidget.duration != widget.duration) {
      _controller.duration = widget.duration;
    }

    if (widget.isActive && !_controller.isAnimating) {
      _controller.repeat();
    } else if (!widget.isActive && _controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isActive) {
      return Container(
        width: widget.size,
        height: widget.size,
        decoration: const BoxDecoration(
          color: TruxifyColors.hintText,
          shape: BoxShape.circle,
        ),
      );
    }

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final pulseSize =
            widget.size + ((widget.size * 1.6) * _controller.value);

        return Stack(
          alignment: Alignment.center,
          children: [
            Container(
              width: pulseSize,
              height: pulseSize,
              decoration: BoxDecoration(
                color: TruxifyColors.success
                    .withValues(alpha: 1.0 - _controller.value),
                shape: BoxShape.circle,
              ),
            ),
            Container(
              width: widget.size,
              height: widget.size,
              decoration: const BoxDecoration(
                color: TruxifyColors.success,
                shape: BoxShape.circle,
              ),
            ),
          ],
        );
      },
    );
  }
}
