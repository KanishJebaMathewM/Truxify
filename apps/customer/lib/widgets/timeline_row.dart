import 'package:flutter/material.dart';

import '../models/app_models.dart';
import '../theme/app_theme.dart';
import 'common_widgets.dart';
import 'timeline_connector.dart';

class TimelineRow extends StatelessWidget {
  const TimelineRow({
    super.key,
    required this.step,
    this.indicatorSize = 14,
    this.connectorColor = TruxifyColors.border,
    this.connectorLength = 42,
    this.connectorThickness = 2,
  });

  final TimelineStepData step;
  final double indicatorSize;
  final Color connectorColor;
  final double connectorLength;
  final double connectorThickness;

  @override
  Widget build(BuildContext context) {
    final color = step.completed ? TruxifyColors.accentDark : TruxifyColors.border;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              width: indicatorSize,
              height: indicatorSize,
              decoration: BoxDecoration(
                color: color,
                shape: BoxShape.circle,
              ),
            ),
            TimelineConnector(
              color: connectorColor,
              width: connectorThickness,
              height: connectorLength,
            ),
          ],
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(top: 0),
            child: InfoCard(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      step.title,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w800),
                    ),
                  ),
                  Text(
                    step.timestamp,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: TruxifyColors.adaptiveSecondaryText(context),
                        ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
