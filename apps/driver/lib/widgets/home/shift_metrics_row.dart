import 'package:flutter/material.dart';
import 'shift_metric_card.dart';

class ShiftMetricsRow extends StatelessWidget {
  const ShiftMetricsRow({
    super.key,
    required this.payValue,
    required this.hoursValue,
    required this.ratingValue,
    this.tripCountValue,
    this.netValue,
  });

  final String payValue;
  final String hoursValue;
  final String ratingValue;

  /// If non-null, replaces the Rating card with a "Trips" completed card.
  final String? tripCountValue;

  /// If non-null, shown as a muted sub-label beneath the earnings value
  /// (e.g. "Net ≈ ₹2,300").
  final String? netValue;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: ShiftMetricCard(
            icon: Icons.account_balance_wallet_outlined,
            value: payValue,
            label: 'Today\'s Pay',
            subLabel: netValue,
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
          child: tripCountValue != null
              ? ShiftMetricCard(
                  icon: Icons.local_shipping_outlined,
                  value: tripCountValue!,
                  label: 'Trips Today',
                  labelKey: const Key('trips_today_label'),
                )
              : ShiftMetricCard(
                  icon: Icons.star_border_rounded,
                  value: ratingValue,
                  label: 'Rating',
                ),
        ),
      ],
    );
  }
}
