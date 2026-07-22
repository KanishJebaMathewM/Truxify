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
  List<RouteCardData> _usualRoutes = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    final connectivity = await Connectivity().checkConnectivity();
    final hasNetwork = connectivity.isNotEmpty && !connectivity.contains(ConnectivityResult.none);
    await _cacheManager.open();
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
        _orderService.fetchHistoryOrders(),
      ]);
      if (!mounted) return;
      final profile = results[0] is Map<String, dynamic> ? results[0] as Map<String, dynamic> : <String, dynamic>{};
      final orders = results[1] is List ? List<Map<String, dynamic>>.from(results[1] as List) : <Map<String, dynamic>>[];
      final history = results[2] is List ? List<Map<String, dynamic>>.from(results[2] as List) : <Map<String, dynamic>>[];
      setState(() {
        _customerName = (profile['full_name']?.toString() ?? profile['name']?.toString() ?? '').trim();
        _activeOrders = orders;
        _usualRoutes = _computeUsualRoutes(history);
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = AppLocalizations.of(context)!.couldNotLoadData;
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

  List<RouteCardData> _computeUsualRoutes(List<Map<String, dynamic>> history) {
    if (history.isEmpty) return const [];

    final routeMap = <String, _RouteStats>{};
    for (final order in history) {
      final pickup = order['pickup_address']?.toString() ?? '';
      final drop = order['drop_address']?.toString() ?? '';
      if (pickup.isEmpty || drop.isEmpty) continue;

      final key = '${pickup}|||${drop}';
      final existing = routeMap[key];
      final dateStr = order['pickup_date']?.toString() ?? '';

      if (existing != null) {
        existing.count++;
        if (dateStr.compareTo(existing.lastDate) > 0) {
          existing.lastDate = dateStr;
        }
      } else {
        routeMap[key] = _RouteStats(
          pickup: pickup,
          drop: drop,
          count: 1,
          lastDate: dateStr,
          pickupLat: (order['pickup_lat'] as num?)?.toDouble(),
          pickupLng: (order['pickup_lng'] as num?)?.toDouble(),
          dropLat: (order['drop_lat'] as num?)?.toDouble(),
          dropLng: (order['drop_lng'] as num?)?.toDouble(),
        );
      }
    }

    final sorted = routeMap.values.toList()
      ..sort((a, b) => b.count.compareTo(a.count));

    return sorted.take(5).map((stats) {
      final displayPickup = _shortenAddress(stats.pickup);
      final displayDrop = _shortenAddress(stats.drop);
      return RouteCardData(
        route: '$displayPickup \u2192 $displayDrop',
        pickup: stats.pickup,
        drop: stats.drop,
        tripCount: stats.count,
        lastUsedDate: stats.lastDate.isNotEmpty ? stats.lastDate : null,
        pickupLat: stats.pickupLat,
        pickupLng: stats.pickupLng,
        dropLat: stats.dropLat,
        dropLng: stats.dropLng,
      );
    }).toList();
  }

  String _shortenAddress(String address) {
    final parts = address.split(',');
    return parts.first.trim();
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
            tooltip: 'Notifications',
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
                        label: AppLocalizations.of(context)!.retry,
                        onPressed: () {
                          setState(() { _isLoading = true; _error = null; });
                          _loadData();
                        },
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadData,
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
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
                      SectionHeader(title: AppLocalizations.of(context)!.activeShipments, actionLabel: AppLocalizations.of(context)!.seeAll, onActionTap: () => controller.openOrders(tabIndex: 0)),
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
                            child: StatCard(title: AppLocalizations.of(context)!.active, value: '${_activeOrders.length}', icon: Icons.local_shipping_rounded),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: StatCard(title: AppLocalizations.of(context)!.moreStats, value: AppLocalizations.of(context)!.moreStats, icon: Icons.inventory_2_rounded),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: StatCard(title: AppLocalizations.of(context)!.moreStats, value: AppLocalizations.of(context)!.savings, icon: Icons.savings_rounded),
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      SectionHeader(
                        title: AppLocalizations.of(context)!.yourUsualRoutes,
                        actionLabel: _usualRoutes.isNotEmpty ? AppLocalizations.of(context)!.viewAllOrders : null,
                        onActionTap: _usualRoutes.isNotEmpty ? () => controller.openOrders(tabIndex: 1) : null,
                      ),
                      const SizedBox(height: 8),
                      if (_usualRoutes.isEmpty)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 24),
                          child: Center(
                            child: Column(
                              children: [
                                Icon(Icons.route_rounded, size: 36, color: TruxifyColors.adaptiveSecondaryText(context)),
                                const SizedBox(height: 8),
                                Text(
                                  AppLocalizations.of(context)!.noRoutesFound,
                                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context)),
                                ),
                              ],
                            ),
                          ),
                        )
                      else
                        ..._usualRoutes.map((route) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: RecentRouteCard(
                            route: route,
                            onRebook: () {
                              controller.openFindTrucks(
                                draft: RouteDraft(
                                  pickup: route.pickup,
                                  drop: route.drop,
                                  dateLabel: 'Tomorrow, 6:00 AM',
                                  goodsType: 'Textile',
                                  weightTonnes: '3',
                                  dimensions: '12 × 6 × 6',
                                  stacked: true,
                                  fragile: false,
                                  requirements: const ['Temperature control', 'Loading help needed'],
                                  pickupLat: route.pickupLat,
                                  pickupLng: route.pickupLng,
                                  dropLat: route.dropLat,
                                  dropLng: route.dropLng,
                                ),
                              );
                            },
                          ),
                        )),
                      const SizedBox(height: 8),
                      PrimaryButton(
                        label: '${AppLocalizations.of(context)!.bookATruck} \u{1f69b}',
                        onPressed: () => controller.openFindTrucks(draft: mockDefaultRouteDraft),
                      ),
                    ],
                  ),
                ),
              ),
    );
  }
}

class _RouteStats {
  _RouteStats({
    required this.pickup,
    required this.drop,
    required this.count,
    required this.lastDate,
    this.pickupLat,
    this.pickupLng,
    this.dropLat,
    this.dropLng,
  });

  final String pickup;
  final String drop;
  int count;
  String lastDate;
  final double? pickupLat;
  final double? pickupLng;
  final double? dropLat;
  final double? dropLng;
}

