import 'package:flutter/material.dart';
import 'shift_metric_card.dart';

class ShiftMetricsRow extends StatelessWidget {
  const ShiftMetricsRow({
    super.key,
    required this.payValue,
    required this.hoursValue,
    required this.ratingValue,
  });

  final String payValue;
  final String hoursValue;
  final String ratingValue;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: ShiftMetricCard(
            icon: Icons.account_balance_wallet_outlined,
            value: payValue,
            label: 'Today\'s Pay',
            labelKey: const Key('today_pay_label'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: ShiftMetricCard(
            icon: Icons.timer_outlined,
            value: hoursValue,
            label: 'Shift Hours',
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: ShiftMetricCard(
            icon: Icons.star_border_rounded,
            value: ratingValue,
            label: 'Rating',
          ),
        ),
      ],
    );
  }
}
