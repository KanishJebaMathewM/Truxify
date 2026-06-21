import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class TimelineMilestone extends StatelessWidget {
  const TimelineMilestone({
    super.key,
    required this.label,
    required this.done,
    this.current = false,
    this.timestamp,
    this.indicatorSize = 18,
    this.labelWidth = 80,
  });

  final String label;
  final bool done;
  final bool current;
  final String? timestamp;
  final double indicatorSize;
  final double labelWidth;

  @override
  Widget build(BuildContext context) {
    final color = current
        ? TruxifyColors.accent
        : done
            ? TruxifyColors.accentDark
            : TruxifyColors.border;

    return Column(
      children: [
        Container(
          width: indicatorSize,
          height: indicatorSize,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            boxShadow: current
                ? [
                    BoxShadow(
                      color: TruxifyColors.accent.withValues(alpha: 0.3),
                      blurRadius: 8,
                      spreadRadius: 1,
                    ),
                  ]
                : const [],
          ),
        ),

        const SizedBox(height: 8),

        // Milestone Name
        SizedBox(
          width: labelWidth,
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
          ),
        ),

        // Timestamp
        if (timestamp != null && timestamp!.isNotEmpty) ...[
          const SizedBox(height: 4),
          SizedBox(
            width: labelWidth,
            child: Text(
              timestamp!,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(
                    fontSize: 10,
                    color: TruxifyColors.adaptiveSecondaryText(context),
                    fontWeight: FontWeight.w500,
                  ),
            ),
          ),
        ],
      ],
    );
  }
}