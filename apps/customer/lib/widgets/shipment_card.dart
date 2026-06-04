import 'package:flutter/material.dart';

import '../models/app_models.dart';
import '../theme/app_theme.dart';
import 'common_widgets.dart';

class ShipmentCard extends StatelessWidget {
  const ShipmentCard({
    super.key,
    required this.shipment,
    required this.onTap,
  });

  final ShipmentCardData shipment;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 290,
        padding: const EdgeInsets.all(16),
        decoration: elevatedSurfaceDecoration(
          color: Theme.of(context).colorScheme.surface,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    shipment.route,
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                if (shipment.isLive) const LiveDot(),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              shipment.driver,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color:
                        TruxifyColors.adaptiveSecondaryText(context),
                  ),
            ),
            const Spacer(),
            Row(
              children: [
                StatusBadge(
                  label: shipment.status,
                  color: shipment.statusColor,
                  filled: true,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'ETA: ${shipment.eta}',
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'Truck ${shipment.truckNumber}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color:
                        TruxifyColors.adaptiveSecondaryText(context),
                  ),
            ),
          ],
        ),
      ),
    );
  }
}