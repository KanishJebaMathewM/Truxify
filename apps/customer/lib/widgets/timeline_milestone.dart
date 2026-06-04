import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class TimelineMilestone extends StatelessWidget {
  const TimelineMilestone({
    super.key,
    required this.label,
    required this.done,
    this.current = false,
    this.indicatorSize = 18,
    this.labelWidth = 70,
  });

  final String label;
  final bool done;
  final bool current;
  final double indicatorSize;
  final double labelWidth;

  @override
  Widget build(BuildContext context) {
    final color = current ? TruxifyColors.accent : done ? TruxifyColors.accentDark : TruxifyColors.border;

    return Column(
      children: [
        Container(
          width: indicatorSize,
          height: indicatorSize,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            boxShadow: current
                ? [BoxShadow(color: TruxifyColors.accent.withValues(alpha: 0.3), blurRadius: 8, spreadRadius: 1)]
                : const [],
          ),
        ),
        const SizedBox(height: 8),
        SizedBox(
          width: labelWidth,
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w700, color: color),
          ),
        ),
      ],
    );
  }
}
