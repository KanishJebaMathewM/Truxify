import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../controllers/app_controller.dart';
import '../core/offline/cache/cache_manager.dart';
import '../data/mock_data.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_logo.dart';
import '../widgets/app_page_route.dart';
import '../widgets/shipment_card.dart';
import '../widgets/common_widgets.dart';
import '../widgets/recent_route_card.dart';
import 'live_tracking_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final CacheManager _cacheManager = CacheManager();
  bool _isOffline = false;
  String _locationLabel = 'Surat, Gujarat';

  @override
  void initState() {
    super.initState();
    _loadLocation();
  }

  Future<void> _loadLocation() async {
    final connectivity = await Connectivity().checkConnectivity();
    final hasNetwork = connectivity != ConnectivityResult.none;
    await _cacheManager.open();
    await _cacheManager.cacheLastLocation(21.1702, 72.8311);
    final cachedLocation = await _cacheManager.getLastLocation();
    if (!mounted) return;

    setState(() {
      _isOffline = !hasNetwork;
      if (cachedLocation != null) {
        _locationLabel = 'Last truck location • ${cachedLocation['latitude']?.toStringAsFixed(3)}, ${cachedLocation['longitude']?.toStringAsFixed(3)}';
      }
    });
  }

  static String _greetingFor(DateTime time) {
    final hour = time.hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

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
    final controller = TruxifyScope.of(context);
    final now = DateTime.now();
    final customerFirstName = mockCustomerName.split(' ').first;
    final greeting = _greetingFor(now);

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
                    color: Theme.of(context).brightness == Brightness.dark ? TruxifyColors.darkBorder : TruxifyColors.border,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.place_rounded, size: 16, color: TruxifyColors.accentDark),
                    const SizedBox(width: 6),
                    Text(_isOffline ? _locationLabel : 'Surat, Gujarat', style: const TextStyle(fontWeight: FontWeight.w700)),
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
            Text('$greeting, $customerFirstName 👋', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            Text(
              DateFormat('EEEE, d MMMM yyyy').format(now),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context)),
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
                  return ShipmentCard(
                    shipment: shipment,
                    onTap: () {
                      Navigator.of(context).push(
                        AppPageRoute(builder: (_) => LiveTrackingScreen(orderId: mockActiveOrders[index].orderId)),
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
                child: RecentRouteCard(
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

