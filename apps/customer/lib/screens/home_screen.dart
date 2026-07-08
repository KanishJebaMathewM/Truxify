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
import '../services/order_service.dart';
import '../services/profile_service.dart';
import '../l10n/app_localizations.dart';
import 'live_tracking_screen.dart';
import 'notifications_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final CacheManager _cacheManager = CacheManager();
  final OrderService _orderService = OrderService();
  final ProfileService _profileService = ProfileService();
  bool _isOffline = false;
  bool _isLoading = true;
  String? _error;
  String _locationLabel = 'Surat, Gujarat';
  String _customerName = '';
  List<Map<String, dynamic>> _activeOrders = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    final connectivity = await Connectivity().checkConnectivity();
    final hasNetwork = connectivity.isNotEmpty && !connectivity.contains(ConnectivityResult.none);
    await _cacheManager.open();
    final existingLocation = await _cacheManager.getLastLocation();
    if (existingLocation == null) {
      await _cacheManager.cacheLastLocation(21.1702, 72.8311);
    }
    final cachedLocation = await _cacheManager.getLastLocation();
    if (!mounted) return;

    setState(() {
      _isOffline = !hasNetwork;
      if (cachedLocation != null) {
        _locationLabel = 'Last truck location \u2022 ${cachedLocation['latitude']?.toStringAsFixed(3)}, ${cachedLocation['longitude']?.toStringAsFixed(3)}';
      }
    });

    try {
      final results = await Future.wait([
        _profileService.fetchProfile(),
        _orderService.fetchActiveOrders(),
      ]);
      if (!mounted) return;
      final profile = results[0] is Map<String, dynamic> ? results[0] as Map<String, dynamic> : <String, dynamic>{};
      final orders = results[1] is List ? List<Map<String, dynamic>>.from(results[1] as List) : <Map<String, dynamic>>[];
      setState(() {
        _customerName = (profile['full_name']?.toString() ?? profile['name']?.toString() ?? '').trim();
        _activeOrders = orders;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load data';
        _isLoading = false;
      });
    }
  }

  static String _greetingFor(DateTime time) {
    final hour = time.hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  void _showComingSoon(BuildContext context, String title) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppLocalizations.of(context)!.comingSoon(title))));
  }

  ShipmentCardData? _buildShipmentFromOrder(Map<String, dynamic> order) {
    final route = '${order['pickup_city'] ?? '?'} \u2192 ${order['drop_city'] ?? '?'}';
    final driverName = order['driver_name']?.toString() ?? '';
    final truckNum = order['truck_number']?.toString() ?? '';
    final driver = driverName.isNotEmpty ? '$driverName | $truckNum' : (truckNum.isNotEmpty ? truckNum : 'Assigning driver');
    final status = order['status']?.toString() ?? 'Active';
    final eta = order['estimated_arrival']?.toString() ?? 'Pending';

    return ShipmentCardData(
      route: route,
      driver: driver,
      truckNumber: truckNum,
      status: status,
      statusColor: status == 'In Transit' ? const Color(0xFF00897B) : const Color(0xFFFFB300),
      eta: eta,
      isLive: status == 'In Transit',
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = TruxifyScope.of(context);
    final now = DateTime.now();
    final displayName = _customerName.isNotEmpty ? _customerName.split(' ').first : 'there';
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
                    Text(_locationLabel, style: const TextStyle(fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
            ),
          ),
          IconButton(
            onPressed: () => Navigator.of(context).push(
              AppPageRoute(builder: (_) => const NotificationsScreen()),
            ),
            icon: const Icon(Icons.notifications_none_rounded),
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!, style: Theme.of(context).textTheme.bodyLarge),
                      const SizedBox(height: 12),
                      PrimaryButton(
                        label: 'Retry',
                        onPressed: () {
                          setState(() { _isLoading = true; _error = null; });
                          _loadData();
                        },
                      ),
                    ],
                  ),
                )
              : SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(AppLocalizations.of(context)!.greetingMessage(greeting, displayName), style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 6),
                      Text(
                        DateFormat('EEEE, d MMMM yyyy').format(now),
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context)),
                      ),
                      const SizedBox(height: 26),
                      SectionHeader(title: 'Active Shipments', actionLabel: 'See all', onActionTap: () => _showComingSoon(context, 'All shipments')),
                      const SizedBox(height: 12),
                      _activeOrders.isEmpty
                          ? Padding(
                              padding: const EdgeInsets.symmetric(vertical: 24),
                              child: Center(
                                child: Text(AppLocalizations.of(context)!.noActiveShipments, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context))),
                              ),
                            )
                          : SizedBox(
                              height: 170,
                              child: ListView.separated(
                                scrollDirection: Axis.horizontal,
                                itemCount: _activeOrders.length,
                                separatorBuilder: (_, __) => const SizedBox(width: 14),
                                itemBuilder: (context, index) {
                                  final shipment = _buildShipmentFromOrder(_activeOrders[index]);
                                  if (shipment == null) return const SizedBox.shrink();
                                  final orderId = _activeOrders[index]['display_id']?.toString() ?? _activeOrders[index]['id']?.toString() ?? '';
                                  return ShipmentCard(
                                    shipment: shipment,
                                    onTap: orderId.isNotEmpty
                                        ? () => Navigator.of(context).push(
                                              AppPageRoute(builder: (_) => LiveTrackingScreen(orderId: orderId)),
                                            )
                                        : () => _showComingSoon(context, 'Live tracking'),
                                  );
                                },
                              ),
                            ),
                      const SizedBox(height: 24),
                      Row(
                        children: [
                          Expanded(
                            child: StatCard(title: 'Active', value: '${_activeOrders.length}', icon: Icons.local_shipping_rounded),
                          ),
                          const SizedBox(width: 10),
                          const Expanded(
                            child: StatCard(title: 'Coming soon', value: 'More stats', icon: Icons.inventory_2_rounded),
                          ),
                          const SizedBox(width: 10),
                          const Expanded(
                            child: StatCard(title: 'Coming soon', value: 'Savings', icon: Icons.savings_rounded),
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      SectionHeader(title: 'Your usual routes'),
                      const SizedBox(height: 8),
                      Center(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 24),
                          child: Text(AppLocalizations.of(context)!.routeHistoryComingSoon, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context))),
                        ),
                      ),
                      const SizedBox(height: 8),
                      PrimaryButton(
                        label: 'Book a Truck \u{1f69b}',
                        onPressed: () => controller.openFindTrucks(draft: mockDefaultRouteDraft),
                      ),
                    ],
                  ),
                ),
    );
  }
}

