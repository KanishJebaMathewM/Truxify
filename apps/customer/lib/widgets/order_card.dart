import 'package:flutter/material.dart';

import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../controllers/app_controller.dart';
import '../services/blockchain_receipt_service.dart';
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
                  color: TruxifyColors.accent,
                  filled: true,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              order.route,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color:
                        TruxifyColors.adaptiveSecondaryText(context),
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
                        TruxifyColors.adaptiveSecondaryText(context),
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
    final isSuccess = order.status == 'Delivered' || order.status == 'Payment Released';
    final statusColor = isSuccess
        ? TruxifyColors.accentDark
        : TruxifyColors.error;

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
                        color: TruxifyColors
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
                                ? TruxifyColors.accent
                                : TruxifyColors.accentDark,
                      ),
                ),
                const SizedBox(width: 10),
                StatusBadge(
                  label: isSuccess
                      ? '✅ ${order.status}'
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
                    fontWeight: FontWeight.bold,
                    color: TruxifyColors.adaptiveSecondaryText(context),
                  ),
            ),
            if (order.goodsType != null) ...[
              const SizedBox(height: 4),
              Text(
                'Goods: ${order.goodsType} (${order.weightTonnes ?? "—"} tonnes)',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
              ),
            ],
            const SizedBox(height: 4),
            Row(
              children: [
                Text(
                  'Rating Given: ',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: TruxifyColors.adaptiveSecondaryText(context),
                      ),
                ),
                if (order.ratingGiven != null)
                  Text(
                    '⭐' * order.ratingGiven!,
                    style: const TextStyle(fontSize: 13),
                  )
                else
                  Text(
                    'Not rated yet',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          fontStyle: FontStyle.italic,
                          color: Colors.grey,
                        ),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                OutlinedButton(
                  onPressed: onTap,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 36),
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                  ),
                  child: const Text('View Details', style: TextStyle(fontSize: 12)),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: () {
                    final routeParts = order.route.split(' → ');
                    final pickup = routeParts.length == 2 ? routeParts.first : order.route;
                    final drop = routeParts.length == 2 ? routeParts.last : order.route;
                    final draft = RouteDraft(
                      pickup: pickup,
                      drop: drop,
                      dateLabel: 'Tomorrow',
                      goodsType: order.goodsType ?? 'Textile',
                      weightTonnes: order.weightTonnes ?? '5',
                      dimensions: order.dimensions ?? '10 × 8 × 6',
                      stacked: order.isStackable ?? true,
                      fragile: order.isFragile ?? false,
                      requirements: const [],
                    );
                    TruxifyScope.of(context).openFindTrucks(draft: draft);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: TruxifyColors.accent,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(0, 36),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                  ),
                  child: const Text('Rebook', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                ),
                if (isSuccess) ...[
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: () => BlockchainReceiptService.showReceipt(context, order.orderId),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: TruxifyColors.accentDark,
                      foregroundColor: Colors.white,
                      minimumSize: const Size(0, 36),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                    ),
                    child: const Text('View Receipt', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}