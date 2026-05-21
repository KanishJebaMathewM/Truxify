import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../controllers/app_controller.dart';
import '../data/mock_data.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_logo.dart';
import '../widgets/app_page_route.dart';
import '../widgets/common_widgets.dart';
import 'live_tracking_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  RouteDraft _draftForRoute(RouteCardData route) {
    return RouteDraft(
      pickup: route.pickup,
      drop: route.drop,
      dateLabel: 'Tomorrow, 6:00 AM',
      goodsType: 'Textile',
      weightTonnes: '3',
      dimensions: '12 × 6 × 6',
      stacked: true,
      fragile: false,
      requirements: const ['Temperature control', 'Loading help needed'],
    );
  }

  void _showComingSoon(BuildContext context, String title) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$title coming soon')));
  }

  @override
  Widget build(BuildContext context) {
    final controller = FreightFairScope.of(context);
    final now = DateTime.now();
    final greeting = now.hour < 12 ? 'Good morning' : now.hour < 17 ? 'Good afternoon' : 'Good evening';

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 20,
        title: const AppLogo(iconSize: 20),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: Theme.of(context).brightness == Brightness.dark ? FreightFairColors.darkBorder : FreightFairColors.border,
                  ),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.place_rounded, size: 16, color: FreightFairColors.accentDark),
                    SizedBox(width: 6),
                    Text('Surat, Gujarat', style: TextStyle(fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
            ),
          ),
          IconButton(
            onPressed: () => _showComingSoon(context, 'Notifications'),
            icon: const Icon(Icons.notifications_none_rounded),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$greeting, Karthik 👋', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            Text(
              DateFormat('EEEE, d MMMM yyyy').format(now),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: FreightFairColors.adaptiveSecondaryText(context)),
            ),
            const SizedBox(height: 26),
            SectionHeader(title: 'Active Shipments', actionLabel: 'See all', onActionTap: () => _showComingSoon(context, 'All shipments')),
            const SizedBox(height: 12),
            SizedBox(
              height: 170,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: mockActiveShipments.length,
                separatorBuilder: (_, __) => const SizedBox(width: 14),
                itemBuilder: (context, index) {
                  final shipment = mockActiveShipments[index];
                  return _ShipmentCard(
                    shipment: shipment,
                    onTap: () {
                      Navigator.of(context).push(
                        AppPageRoute(builder: (_) => LiveTrackingScreen(orderId: index == 0 ? '#FF20241205' : '#FF20241198')),
                      );
                    },
                  );
                },
              ),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(child: StatCard(title: mockQuickStats[0].title, value: mockQuickStats[0].value, icon: mockQuickStats[0].icon)),
                const SizedBox(width: 10),
                Expanded(child: StatCard(title: mockQuickStats[1].title, value: mockQuickStats[1].value, icon: mockQuickStats[1].icon)),
                const SizedBox(width: 10),
                Expanded(child: StatCard(title: mockQuickStats[2].title, value: mockQuickStats[2].value, icon: mockQuickStats[2].icon)),
              ],
            ),
            const SizedBox(height: 24),
            SectionHeader(title: 'Your usual routes'),
            const SizedBox(height: 8),
            ...mockRecentRoutes.map(
              (route) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _RecentRouteCard(
                  route: route,
                  onRebook: () => controller.openFindTrucks(draft: _draftForRoute(route)),
                ),
              ),
            ),
            const SizedBox(height: 8),
            PrimaryButton(
              label: 'Book a Truck 🚛',
              onPressed: () => controller.openFindTrucks(draft: mockDefaultRouteDraft),
            ),
          ],
        ),
      ),
    );
  }
}

class _ShipmentCard extends StatelessWidget {
  const _ShipmentCard({required this.shipment, required this.onTap});

  final ShipmentCardData shipment;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 290,
        padding: const EdgeInsets.all(16),
        decoration: elevatedSurfaceDecoration(color: Theme.of(context).colorScheme.surface),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(shipment.route, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                ),
                if (shipment.isLive) const LiveDot(),
              ],
            ),
            const SizedBox(height: 10),
            Text(shipment.driver, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: FreightFairColors.adaptiveSecondaryText(context))),
            const Spacer(),
            Row(
              children: [
                StatusBadge(label: shipment.status, color: shipment.statusColor, filled: true),
                const SizedBox(width: 10),
                Expanded(
                  child: Text('ETA: ${shipment.eta}', style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text('Truck ${shipment.truckNumber}', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: FreightFairColors.adaptiveSecondaryText(context))),
          ],
        ),
      ),
    );
  }
}

class _RecentRouteCard extends StatelessWidget {
  const _RecentRouteCard({required this.route, required this.onRebook});

  final RouteCardData route;
  final VoidCallback onRebook;

  @override
  Widget build(BuildContext context) {
    return InfoCard(
      child: Row(
        children: [
          const Icon(Icons.route_rounded, color: FreightFairColors.accentDark),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(route.route, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text('${route.pickup} to ${route.drop}', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: FreightFairColors.adaptiveSecondaryText(context))),
              ],
            ),
          ),
          const SizedBox(width: 12),
          _RecentRouteAction(onPressed: onRebook),
        ],
      ),
    );
  }
}

class _RecentRouteAction extends StatelessWidget {
  const _RecentRouteAction({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(minimumSize: const Size(0, 42), padding: const EdgeInsets.symmetric(horizontal: 14)),
      child: const Text('Rebook'),
    );
  }
}
