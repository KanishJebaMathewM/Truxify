import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'common_widgets.dart';

class ShimmerLoading extends StatefulWidget {
  final double width;
  final double height;
  final double borderRadius;

  const ShimmerLoading({
    super.key,
    this.width = double.infinity,
    required this.height,
    this.borderRadius = 8,
  });

  @override
  State<ShimmerLoading> createState() => _ShimmerLoadingState();
}

class _ShimmerLoadingState extends State<ShimmerLoading>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final baseColor =
        isDark ? const Color(0xFF2A2A2E) : const Color(0xFFE8E0E0);
    final highlightColor =
        isDark ? const Color(0xFF3A3A3E) : const Color(0xFFF0E8E8);

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.borderRadius),
            gradient: LinearGradient(
              colors: [baseColor, highlightColor, baseColor],
              stops: const [0.0, 0.5, 1.0],
              begin: Alignment(-1.0 + _controller.value * 2, 0),
              end: Alignment(1.0 + _controller.value * 2, 0),
            ),
          ),
        );
      },
    );
  }
}

/// Shimmer skeleton for the hero earnings card.
class HeroShimmer extends StatelessWidget {
  const HeroShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark
            ? TruxifyColors.darkCardBackground
            : const Color(0xFFD4BFBF),
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ShimmerLoading(width: 80, height: 12),
          SizedBox(height: 12),
          ShimmerLoading(width: 160, height: 36, borderRadius: 4),
          SizedBox(height: 16),
          ShimmerLoading(height: 6, borderRadius: 3),
          SizedBox(height: 24),
          Row(
            children: [
              Expanded(child: ShimmerLoading(height: 36)),
              SizedBox(width: 12),
              Expanded(child: ShimmerLoading(height: 36)),
              SizedBox(width: 12),
              Expanded(child: ShimmerLoading(height: 36)),
            ],
          ),
        ],
      ),
    );
  }
}

/// Generic section shimmer placeholder.
class SectionShimmer extends StatelessWidget {
  final double height;
  const SectionShimmer({super.key, this.height = 180});

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const ShimmerLoading(width: 200, height: 16),
            const SizedBox(height: 20),
            ShimmerLoading(height: height - 60),
          ],
        ),
      ),
    );
  }
}
