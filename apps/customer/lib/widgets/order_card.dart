import 'package:flutter/material.dart';

import '../models/app_models.dart';
import '../theme/app_theme.dart';
import 'common_widgets.dart';

class ActiveOrderCard extends StatelessWidget {
  const ActiveOrderCard({
    super.key,
    required this.order,
    required this.onTap,
  });

  final ActiveOrderData order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: InfoCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    order.orderId,
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                StatusBadge(
                  label: order.milestone,
                  color: FreightFairColors.accent,
                  filled: true,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              order.route,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color:
                        FreightFairColors.adaptiveSecondaryText(context),
                  ),
            ),
            const SizedBox(height: 8),
            Text(
              'Driver: ${order.driver}',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(
              'ETA: ${order.eta}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color:
                        FreightFairColors.adaptiveSecondaryText(context),
                  ),
            ),
            const SizedBox(height: 14),
            PrimaryButton(
              label: 'Track Live',
              onPressed: onTap,
            ),
          ],
        ),
      ),
    );
  }
}

class HistoryOrderCard extends StatelessWidget {
  const HistoryOrderCard({
    super.key,
    required this.order,
    required this.onTap,
  });

  final HistoryOrderData order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final statusColor = order.status == 'Delivered'
        ? FreightFairColors.accentDark
        : FreightFairColors.error;

    return GestureDetector(
      onTap: onTap,
      child: InfoCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    order.route,
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                Text(
                  order.date,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(
                        color: FreightFairColors
                            .adaptiveSecondaryText(context),
                      ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Text(
                  order.amount,
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(
                        fontWeight: FontWeight.w800,
                        color:
                            Theme.of(context).brightness ==
                                    Brightness.dark
                                ? FreightFairColors.accent
                                : FreightFairColors.accentDark,
                      ),
                ),
                const SizedBox(width: 10),
                StatusBadge(
                  label: order.status == 'Delivered'
                      ? '✅ Delivered'
                      : '❌ Cancelled',
                  color: statusColor,
                  filled: true,
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'Driver: ${order.driver}',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(
                    color:
                        FreightFairColors.adaptiveSecondaryText(context),
                  ),
            ),
            const SizedBox(height: 14),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton(
                onPressed: onTap,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 42),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14),
                ),
                child: const Text('View Details'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}