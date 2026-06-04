import 'package:flutter/material.dart';

import '../models/app_models.dart';
import '../theme/app_theme.dart';
import 'common_widgets.dart';
import 'recent_route_action.dart';

class RecentRouteCard extends StatelessWidget {
  const RecentRouteCard({
    super.key,
    required this.route,
    required this.onRebook,
  });

  final RouteCardData route;
  final VoidCallback onRebook;

  @override
  Widget build(BuildContext context) {
    return InfoCard(
      child: Row(
        children: [
          const Icon(Icons.route_rounded, color: TruxifyColors.accentDark),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(route.route, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text(
                  '${route.pickup} to ${route.drop}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context)),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          RecentRouteAction(onPressed: onRebook),
        ],
      ),
    );
  }
}
