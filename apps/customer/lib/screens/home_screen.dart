// apps/customer/lib/screens/home_screen.dart
//
// Responsive dashboard:
//   - Desktop: high-density multi-column dashboard
//   - Tablet: adaptive two-column sections
//   - Mobile: single-column layout
//   - Quick stats: Active Loads, Delivered This Month, Pending Invoices
//   - Quick Book Freight
//   - Freight Spending
//   - Truck Availability
//   - Voice AI Assistant
//   - Active shipment live cards
//   - Recent search routes

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:truxify_shared/truxify_shared.dart' hide NotificationsScreen;

import '../controllers/app_controller.dart';
import '../core/offline/cache/cache_manager.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../utils/breakpoints.dart';
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
import '../utils/driver_utils.dart';

class HomeScreen extends StatefulWidget {
  final OrderService? orderService;
  final ProfileService? profileService;

  const HomeScreen({
    super.key,
    this.orderService,
    this.profileService,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final CacheManager _cacheManager = CacheManager();

  late final OrderService _orderService;
  late final ProfileService _profileService;

  bool _isOffline = false;
  bool _isLoading = true;

  String? _error;

  String _locationLabel = 'Surat, Gujarat';
  String _customerName = '';

  List<Map<String, dynamic>> _activeOrders = [];

  Map<String, dynamic>? _customerStats;

  List<RouteCardData> _usualRoutes = [];

  @override
  void initState() {
    super.initState();

    _orderService = widget.orderService ?? OrderService();
    _profileService = widget.profileService ?? ProfileService();

    _loadData();
  }

  Future<void> _loadData() async {
    final connectivity = await Connectivity().checkConnectivity();

    final hasNetwork = connectivity.isNotEmpty &&
        !connectivity.contains(ConnectivityResult.none);

    await _cacheManager.open();

    final cachedLocation = await _cacheManager.getLastLocation();

    if (!mounted) return;

    setState(() {
      _isOffline = !hasNetwork;

      if (cachedLocation != null) {
        _locationLabel =
            'Last truck location • '
            '${cachedLocation['latitude']?.toStringAsFixed(3)}, '
            '${cachedLocation['longitude']?.toStringAsFixed(3)}';
      }
    });

    try {
      final results = await Future.wait([
        _profileService.fetchProfile(),
        _orderService.fetchActiveOrders(),
        _profileService.fetchCustomerStats(),
        _orderService.fetchHistoryOrders(),
      ]);

      if (!mounted) return;

      final profileResponse = results[0] is Map<String, dynamic>
          ? results[0] as Map<String, dynamic>
          : <String, dynamic>{};

      final profile = profileResponse['profile'] is Map<String, dynamic>
          ? profileResponse['profile'] as Map<String, dynamic>
          : <String, dynamic>{};

      final orders = results[1] is List
          ? List<Map<String, dynamic>>.from(results[1] as List)
          : <Map<String, dynamic>>[];

      final stats = results[2] is Map<String, dynamic>
          ? results[2] as Map<String, dynamic>
          : null;

      final history = results[3] is List
          ? List<Map<String, dynamic>>.from(results[3] as List)
          : <Map<String, dynamic>>[];

      setState(() {
        _customerName =
            (profile['fullName']?.toString() ?? '').trim();

        _activeOrders = orders;

        _customerStats = stats;

        _usualRoutes = _computeUsualRoutes(history);

        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;

      setState(() {
        _error =
            AppLocalizations.of(context)!.couldNotLoadData;

        _isLoading = false;
      });
    }
  }

  static String _greetingFor(DateTime time) {
    final hour = time.hour;

    if (hour < 12) {
      return 'Good morning';
    }

    if (hour < 17) {
      return 'Good afternoon';
    }

    return 'Good evening';
  }

  String _formatSavingsValue() {
    final totalSaved =
        (_customerStats?['totalSaved'] as num?)?.toDouble() ?? 0;

    return '₹${(totalSaved / 100).toStringAsFixed(
      totalSaved % 100 == 0 ? 0 : 2,
    )}';
  }

  void _showComingSoon(
    BuildContext context,
    String title,
  ) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          AppLocalizations.of(context)!
              .comingSoon(title),
        ),
      ),
    );
  }

  List<RouteCardData> _computeUsualRoutes(
    List<Map<String, dynamic>> history,
  ) {
    if (history.isEmpty) {
      return const [];
    }

    final routeMap = <String, _RouteStats>{};

    for (final order in history) {
      final pickup =
          order['pickup_address']?.toString() ?? '';

      final drop =
          order['drop_address']?.toString() ?? '';

      if (pickup.isEmpty || drop.isEmpty) {
        continue;
      }

      final key = '${pickup}|||${drop}';

      final existing = routeMap[key];

      final dateStr =
          order['pickup_date']?.toString() ?? '';

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
          pickupLat:
              (order['pickup_lat'] as num?)?.toDouble(),
          pickupLng:
              (order['pickup_lng'] as num?)?.toDouble(),
          dropLat:
              (order['drop_lat'] as num?)?.toDouble(),
          dropLng:
              (order['drop_lng'] as num?)?.toDouble(),
        );
      }
    }

    final sorted = routeMap.values.toList()
      ..sort(
        (a, b) => b.count.compareTo(a.count),
      );

    return sorted.take(5).map((stats) {
      final displayPickup =
          _shortenAddress(stats.pickup);

      final displayDrop =
          _shortenAddress(stats.drop);

      return RouteCardData(
        route:
            '$displayPickup → $displayDrop',
        pickup: stats.pickup,
        drop: stats.drop,
        tripCount: stats.count,
        lastUsedDate:
            stats.lastDate.isNotEmpty
                ? stats.lastDate
                : null,
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

  String _formatStatus(String status) {
    switch (status) {
      case 'driver_assigned':
      case 'accepted':
        return 'Accepted';

      case 'in_transit':
        return 'In Transit';

      case 'payment_released':
      case 'completed':
      case 'delivered':
        return 'Delivered';

      case 'cancelled':
        return 'Cancelled';

      case 'pending':
        return 'Pending';

      default:
        return status
            .split('_')
            .map(
              (word) => word.isEmpty
                  ? word
                  : '${word[0].toUpperCase()}'
                      '${word.substring(1)}',
            )
            .join(' ');
    }
  }

  ShipmentCardData? _buildShipmentFromOrder(
    Map<String, dynamic> order,
  ) {
    final route =
        '${order['pickup_city'] ?? '?'}'
        ' → '
        '${order['drop_city'] ?? '?'}';

    final rawDriverName =
        order['driver_name']?.toString() ?? '';

    final hasDriver =
        DriverUtils.isValidDriverName(rawDriverName);

    final driverName =
        hasDriver ? rawDriverName : '';

    final truckNum =
        order['truck_number']?.toString() ?? '';

    final driver = driverName.isNotEmpty
        ? '$driverName | $truckNum'
        : truckNum.isNotEmpty
            ? truckNum
            : 'Assigning driver';

    final status = _formatStatus(
      order['status']?.toString() ?? 'pending',
    );

    final eta =
        order['eta']?.toString() ?? 'Pending';

    return ShipmentCardData(
      route: route,
      driver: driver,
      truckNumber: truckNum,
      status: status,
      statusColor: status == 'In Transit'
          ? const Color(0xFF00897B)
          : const Color(0xFFFFB300),
      eta: eta,
      isLive: status == 'In Transit',
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller =
        TruxifyScope.of(context);

    final now = DateTime.now();

    final displayName =
        _customerName.isNotEmpty
            ? _customerName.split(' ').first
            : 'there';

    final greeting =
        _greetingFor(now);

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 20,

        title: const AppLogo(
          iconSize: 20,
        ),

        actions: [
          Padding(
            padding:
                const EdgeInsets.only(right: 8),

            child: Center(
              child: Container(
                constraints:
                    const BoxConstraints(
                  maxWidth: 300,
                ),

                padding:
                    const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),

                decoration: BoxDecoration(
                  color: Theme.of(context)
                      .colorScheme
                      .surfaceContainerHighest,

                  borderRadius:
                      BorderRadius.circular(999),

                  border: Border.all(
                    color: Theme.of(context)
                            .brightness ==
                        Brightness.dark
                        ? TruxifyColors.darkBorder
                        : TruxifyColors.border,
                  ),
                ),

                child: Row(
                  mainAxisSize:
                      MainAxisSize.min,

                  children: [
                    const Icon(
                      Icons.place_rounded,
                      size: 16,
                      color:
                          TruxifyColors.accentDark,
                    ),

                    const SizedBox(width: 6),

                    Flexible(
                      child: Text(
                        _locationLabel,
                        overflow:
                            TextOverflow.ellipsis,

                        style:
                            const TextStyle(
                          fontWeight:
                              FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          IconButton(
            tooltip: 'Notifications',

            onPressed: () =>
                Navigator.of(context).push(
              AppPageRoute(
                builder: (_) =>
                    const NotificationsScreen(),
              ),
            ),

            icon: const Icon(
              Icons.notifications_none_rounded,
            ),
          ),
        ],
      ),

      body: _isLoading
          ? const Center(
              child:
                  CircularProgressIndicator(),
            )
          : _error != null
              ? _buildErrorState(context)
              : RefreshIndicator(
                  onRefresh: _loadData,

                  child: LayoutBuilder(
                    builder:
                        (context, constraints) {
                      final width =
                          constraints.maxWidth;

                      final isDesktop =
                          width >= 1100;

                      final isTablet =
                          width >= 700 &&
                              width < 1100;

                      return SingleChildScrollView(
                        physics:
                            const AlwaysScrollableScrollPhysics(),

                        padding:
                            EdgeInsets.symmetric(
                          horizontal: isDesktop
                              ? 32
                              : isTablet
                                  ? 24
                                  : 16,

                          vertical: 20,
                        ),

                        child: Center(
                          child: ConstrainedBox(
                            constraints:
                                const BoxConstraints(
                              maxWidth: 1440,
                            ),

                            child: Column(
                              crossAxisAlignment:
                                  CrossAxisAlignment.start,

                              children: [
                                // -------------------------
                                // GREETING
                                // -------------------------

                                Text(
                                  AppLocalizations.of(
                                    context,
                                  )!.greetingMessage(
                                    greeting,
                                    displayName,
                                  ),

                                  style:
                                      Theme.of(
                                    context,
                                  )
                                          .textTheme
                                          .headlineSmall
                                          ?.copyWith(
                                            fontWeight:
                                                FontWeight.w800,
                                          ),
                                ),

                                const SizedBox(
                                  height: 6,
                                ),

                                Text(
                                  DateFormatter
                                      .formatFullDate(
                                    now,
                                  ),

                                  style:
                                      Theme.of(
                                    context,
                                  )
                                          .textTheme
                                          .bodyMedium
                                          ?.copyWith(
                                            color:
                                                TruxifyColors
                                                    .adaptiveSecondaryText(
                                              context,
                                            ),
                                          ),
                                ),

                                const SizedBox(
                                  height: 24,
                                ),

                                // -------------------------
                                // QUICK STATS
                                // -------------------------

                                _buildQuickStats(
                                  context,

                                  isDesktop:
                                      isDesktop,

                                  isTablet:
                                      isTablet,
                                ),

                                const SizedBox(
                                  height: 24,
                                ),

                                // -------------------------
                                // DASHBOARD
                                // -------------------------

                                if (isDesktop)
                                  _buildDesktopDashboard(
                                    context,
                                    controller,
                                  )
                                else if (isTablet)
                                  _buildTabletDashboard(
                                    context,
                                    controller,
                                  )
                                else
                                  _buildMobileDashboard(
                                    context,
                                    controller,
                                  ),

                                const SizedBox(
                                  height: 24,
                                ),

                                // -------------------------
                                // ACTIVE SHIPMENTS
                                // -------------------------

                                _buildActiveShipments(
                                  context,
                                  controller,
                                  isDesktop:
                                      isDesktop,
                                ),

                                const SizedBox(
                                  height: 24,
                                ),

                                // -------------------------
                                // RECENT ROUTES
                                // -------------------------

                                _buildRecentRoutes(
                                  context,
                                  controller,
                                ),

                                const SizedBox(
                                  height: 20,
                                ),

                                // -------------------------
                                // BOOK TRUCK
                                // -------------------------

                                SizedBox(
                                  width:
                                      double.infinity,

                                  child:
                                      PrimaryButton(
                                    label:
                                        '${AppLocalizations.of(context)!.bookATruck} 🚚',

                                    onPressed: () =>
                                        controller
                                            .openFindTrucks(),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }

  Widget _buildErrorState(
    BuildContext context,
  ) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,

        children: [
          Text(
            _error!,

            style:
                Theme.of(context)
                    .textTheme
                    .bodyLarge,
          ),

          const SizedBox(
            height: 12,
          ),

          PrimaryButton(
            label:
                AppLocalizations.of(context)!
                    .retry,

            onPressed: () {
              setState(() {
                _isLoading = true;
                _error = null;
              });

              _loadData();
            },
          ),
        ],
      ),
    );
  }

  // ==========================================================
  // QUICK STATS
  // ==========================================================

  Widget _buildQuickStats(
    BuildContext context, {
    required bool isDesktop,
    required bool isTablet,
  }) {
    final activeLoads =
        _activeOrders.length;

    final deliveredThisMonth =
        _customerStats?[
                'deliveredThisMonth'] ??
            _customerStats?[
                'delivered_this_month'] ??
            _customerStats?[
                'monthlyDelivered'] ??
            0;

    final pendingInvoices =
        _customerStats?[
                'pendingInvoices'] ??
            _customerStats?[
                'pending_invoices'] ??
            0;

    final cards = [
      _DashboardStat(
        title: 'Active Loads',
        value: '$activeLoads',
        icon:
            Icons.local_shipping_rounded,
      ),

      _DashboardStat(
        title: 'Delivered This Month',
        value:
            '$deliveredThisMonth',
        icon:
            Icons.check_circle_outline_rounded,
      ),

      _DashboardStat(
        title: 'Pending Invoices',
        value:
            '$pendingInvoices',
        icon:
            Icons.receipt_long_rounded,
      ),
    ];

    if (isDesktop || isTablet) {
      return GridView.builder(
        shrinkWrap: true,

        physics:
            const NeverScrollableScrollPhysics(),

        itemCount: cards.length,

        gridDelegate:
            SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount:
              isDesktop ? 3 : 2,

          crossAxisSpacing: 14,
          mainAxisSpacing: 14,

          childAspectRatio:
              isDesktop ? 3.2 : 2.8,
        ),

        itemBuilder:
            (context, index) {
          final card = cards[index];

          return _buildDashboardStatCard(
            context,

            title: card.title,
            value: card.value,
            icon: card.icon,
          );
        },
      );
    }

    return Column(
      children: cards
          .map(
            (card) => Padding(
              padding:
                  const EdgeInsets.only(
                bottom: 12,
              ),

              child:
                  _buildDashboardStatCard(
                context,

                title: card.title,
                value: card.value,
                icon: card.icon,
              ),
            ),
          )
          .toList(),
    );
  }

  Widget _buildDashboardStatCard(
    BuildContext context, {
    required String title,
    required String value,
    required IconData icon,
  }) {
    final theme =
        Theme.of(context);

    return Container(
      padding:
          const EdgeInsets.all(18),

      decoration: BoxDecoration(
        color:
            theme.colorScheme.surface,

        borderRadius:
            BorderRadius.circular(18),

        border: Border.all(
          color:
              theme.brightness ==
                      Brightness.dark
                  ? TruxifyColors.darkBorder
                  : TruxifyColors.border,
        ),
      ),

      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,

            decoration:
                BoxDecoration(
              color: theme
                  .colorScheme
                  .primary
                  .withValues(
                alpha: 0.10,
              ),

              borderRadius:
                  BorderRadius.circular(
                12,
              ),
            ),

            child: Icon(
              icon,
              color:
                  theme.colorScheme.primary,
            ),
          ),

          const SizedBox(
            width: 14,
          ),

          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,

              mainAxisAlignment:
                  MainAxisAlignment.center,

              children: [
                Text(
                  title,

                  maxLines: 1,

                  overflow:
                      TextOverflow.ellipsis,

                  style: theme
                      .textTheme
                      .bodySmall
                      ?.copyWith(
                    color:
                        TruxifyColors
                            .adaptiveSecondaryText(
                      context,
                    ),
                  ),
                ),

                const SizedBox(
                  height: 4,
                ),

                Text(
                  value,

                  style: theme
                      .textTheme
                      .titleLarge
                      ?.copyWith(
                    fontWeight:
                        FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ==========================================================
  // DESKTOP
  // ==========================================================

  Widget _buildDesktopDashboard(
    BuildContext context,
    dynamic controller,
  ) {
    return Row(
      crossAxisAlignment:
          CrossAxisAlignment.start,

      children: [
        Expanded(
          flex: 2,

          child: Column(
            children: [
              _buildQuickBookCard(
                context,
                controller,
              ),

              const SizedBox(
                height: 16,
              ),

              _buildRecentRoutesPreview(
                context,
                controller,
              ),
            ],
          ),
        ),

        const SizedBox(
          width: 20,
        ),

        Expanded(
          flex: 1,

          child: Column(
            children: [
              _buildSpendingCard(
                context,
              ),

              const SizedBox(
                height: 16,
              ),

              _buildTruckAvailabilityCard(
                context,
              ),

              const SizedBox(
                height: 16,
              ),

              _buildVoiceAssistantCard(
                context,
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ==========================================================
  // TABLET
  // ==========================================================

  Widget _buildTabletDashboard(
    BuildContext context,
    dynamic controller,
  ) {
    return Column(
      children: [
        _buildQuickBookCard(
          context,
          controller,
        ),

        const SizedBox(
          height: 16,
        ),

        Row(
          crossAxisAlignment:
              CrossAxisAlignment.start,

          children: [
            Expanded(
              child:
                  _buildSpendingCard(
                context,
              ),
            ),

            const SizedBox(
              width: 14,
            ),

            Expanded(
              child:
                  _buildTruckAvailabilityCard(
                context,
              ),
            ),
          ],
        ),

        const SizedBox(
          height: 16,
        ),

        _buildVoiceAssistantCard(
          context,
        ),

        const SizedBox(
          height: 16,
        ),

        _buildRecentRoutesPreview(
          context,
          controller,
        ),
      ],
    );
  }

  // ==========================================================
  // MOBILE
  // ==========================================================

  Widget _buildMobileDashboard(
    BuildContext context,
    dynamic controller,
  ) {
    return Column(
      children: [
        _buildQuickBookCard(
          context,
          controller,
        ),

        const SizedBox(
          height: 16,
        ),

        _buildSpendingCard(
          context,
        ),

        const SizedBox(
          height: 16,
        ),

        _buildTruckAvailabilityCard(
          context,
        ),

        const SizedBox(
          height: 16,
        ),

        _buildVoiceAssistantCard(
          context,
        ),

        const SizedBox(
          height: 16,
        ),

        _buildRecentRoutesPreview(
          context,
          controller,
        ),
      ],
    );
  }

  // ==========================================================
  // QUICK BOOK
  // ==========================================================

  Widget _buildQuickBookCard(
    BuildContext context,
    dynamic controller,
  ) {
    final theme =
        Theme.of(context);

    return Container(
      width: double.infinity,

      padding:
          const EdgeInsets.all(22),

      decoration:
          BoxDecoration(
        gradient:
            LinearGradient(
          colors: [
            theme
                .colorScheme
                .primary,

            theme
                .colorScheme
                .primaryContainer,
          ],
        ),

        borderRadius:
            BorderRadius.circular(
          22,
        ),
      ),

      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,

        children: [
          Row(
            children: [
              Container(
                width: 46,
                height: 46,

                decoration:
                    BoxDecoration(
                  color: Colors.white
                      .withValues(
                    alpha: 0.18,
                  ),

                  borderRadius:
                      BorderRadius.circular(
                    14,
                  ),
                ),

                child: const Icon(
                  Icons.local_shipping_rounded,
                  color: Colors.white,
                ),
              ),

              const SizedBox(
                width: 14,
              ),

              Expanded(
                child: Text(
                  'Quick Book Freight',

                  style: theme
                      .textTheme
                      .titleLarge
                      ?.copyWith(
                    color:
                        Colors.white,

                    fontWeight:
                        FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(
            height: 12,
          ),

          Text(
            'Find a suitable truck and book your next shipment quickly.',

            style: theme
                .textTheme
                .bodyMedium
                ?.copyWith(
              color:
                  Colors.white
                      .withValues(
                alpha: 0.9,
              ),
            ),
          ),

          const SizedBox(
            height: 18,
          ),

          SizedBox(
            width: double.infinity,

            child:
                FilledButton.icon(
              onPressed: () =>
                  controller
                      .openFindTrucks(),

              icon: const Icon(
                Icons.search_rounded,
              ),

              label:
                  const Text(
                'Find Trucks',
              ),

              style:
                  FilledButton.styleFrom(
                backgroundColor:
                    Colors.white,

                foregroundColor:
                    theme
                        .colorScheme
                        .primary,

                padding:
                    const EdgeInsets
                        .symmetric(
                  vertical: 14,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ==========================================================
  // SPENDING
  // ==========================================================

  Widget _buildSpendingCard(
    BuildContext context,
  ) {
    final theme =
        Theme.of(context);

    final totalSaved =
        (_customerStats?[
                    'totalSaved']
                as num?)
            ?.toDouble() ??
        0;

    return _buildInfoCard(
      context,

      title:
          'Freight Spending',

      icon:
          Icons.account_balance_wallet_rounded,

      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,

        children: [
          Text(
            _formatSavingsValue(),

            style: theme
                .textTheme
                .headlineSmall
                ?.copyWith(
              fontWeight:
                  FontWeight.w800,
            ),
          ),

          const SizedBox(
            height: 6,
          ),

          Text(
            'Total savings',

            style: theme
                .textTheme
                .bodySmall
                ?.copyWith(
              color:
                  TruxifyColors
                      .adaptiveSecondaryText(
                context,
              ),
            ),
          ),

          const SizedBox(
            height: 16,
          ),

          LinearProgressIndicator(
            value:
                totalSaved > 0
                    ? 0.65
                    : 0,

            minHeight: 7,

            borderRadius:
                BorderRadius.circular(
              10,
            ),
          ),

          const SizedBox(
            height: 8,
          ),

          Text(
            'Track your freight spending and savings.',

            style: theme
                .textTheme
                .bodySmall
                ?.copyWith(
              color:
                  TruxifyColors
                      .adaptiveSecondaryText(
                context,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ==========================================================
  // TRUCK AVAILABILITY
  // ==========================================================

  Widget _buildTruckAvailabilityCard(
    BuildContext context,
  ) {
    return _buildInfoCard(
      context,

      title:
          'Truck Availability',

      icon:
          Icons.local_shipping_rounded,

      child: Row(
        children: [
          Container(
            width: 12,
            height: 12,

            decoration:
                const BoxDecoration(
              color: Colors.green,
              shape:
                  BoxShape.circle,
            ),
          ),

          const SizedBox(
            width: 10,
          ),

          Expanded(
            child: Text(
              'Nearby hubs',

              style: Theme.of(
                context,
              )
                  .textTheme
                  .bodyMedium
                  ?.copyWith(
                fontWeight:
                    FontWeight.w600,
              ),
            ),
          ),

          TextButton(
            onPressed: () {
              _showComingSoon(
                context,
                'Truck availability',
              );
            },

            child:
                const Text('View'),
          ),
        ],
      ),
    );
  }

  // ==========================================================
  // VOICE AI
  // ==========================================================

  Widget _buildVoiceAssistantCard(
    BuildContext context,
  ) {
    return _buildInfoCard(
      context,

      title:
          'Voice AI Assistant',

      icon:
          Icons.mic_rounded,

      child: Row(
        children: [
          Expanded(
            child: Text(
              'Get help with booking and shipment information using Voice AI.',

              style: Theme.of(
                context,
              )
                  .textTheme
                  .bodyMedium,
            ),
          ),

          const SizedBox(
            width: 12,
          ),

          IconButton.filled(
            tooltip:
                'Voice AI',

            onPressed: () {
              _showComingSoon(
                context,
                'Voice AI Assistant',
              );
            },

            icon: const Icon(
              Icons.mic_rounded,
            ),
          ),
        ],
      ),
    );
  }

  // ==========================================================
  // GENERIC INFO CARD
  // ==========================================================

  Widget _buildInfoCard(
    BuildContext context, {
    required String title,
    required IconData icon,
    required Widget child,
  }) {
    final theme =
        Theme.of(context);

    return Container(
      width: double.infinity,

      padding:
          const EdgeInsets.all(18),

      decoration:
          BoxDecoration(
        color:
            theme.colorScheme.surface,

        borderRadius:
            BorderRadius.circular(18),

        border: Border.all(
          color:
              theme.brightness ==
                      Brightness.dark
                  ? TruxifyColors.darkBorder
                  : TruxifyColors.border,
        ),
      ),

      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,

        children: [
          Row(
            children: [
              Icon(
                icon,

                size: 21,

                color:
                    theme.colorScheme.primary,
              ),

              const SizedBox(
                width: 8,
              ),

              Expanded(
                child: Text(
                  title,

                  style: theme
                      .textTheme
                      .titleMedium
                      ?.copyWith(
                    fontWeight:
                        FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(
            height: 16,
          ),

          child,
        ],
      ),
    );
  }

  // ==========================================================
  // RECENT ROUTES PREVIEW
  // ==========================================================

  Widget _buildRecentRoutesPreview(
    BuildContext context,
    dynamic controller,
  ) {
    return _buildInfoCard(
      context,

      title:
          'Recent Search Routes',

      icon:
          Icons.route_rounded,

      child: _usualRoutes.isEmpty
          ? Padding(
              padding:
                  const EdgeInsets.symmetric(
                vertical: 12,
              ),

              child: Center(
                child: Text(
                  'No usual routes yet',

                  style: Theme.of(
                    context,
                  )
                      .textTheme
                      .bodyMedium
                      ?.copyWith(
                    color:
                        TruxifyColors
                            .adaptiveSecondaryText(
                      context,
                    ),
                  ),
                ),
              ),
            )
          : Column(
              children:
                  _usualRoutes
                      .take(3)
                      .map(
                        (route) =>
                            Padding(
                          padding:
                              const EdgeInsets
                                  .only(
                            bottom: 10,
                          ),

                          child:
                              RecentRouteCard(
                            route:
                                route,

                            onRebook:
                                () {
                              controller
                                  .openFindTrucks(
                                draft:
                                    RouteDraft(
                                  pickup:
                                      route.pickup,

                                  drop:
                                      route.drop,

                                  dateLabel:
                                      '',

                                  goodsType:
                                      '',

                                  weightTonnes:
                                      '',

                                  dimensions:
                                      '',

                                  stacked:
                                      false,

                                  fragile:
                                      false,

                                  requirements:
                                      const [],

                                  pickupLat:
                                      route.pickupLat,

                                  pickupLng:
                                      route.pickupLng,

                                  dropLat:
                                      route.dropLat,

                                  dropLng:
                                      route.dropLng,
                                ),
                              );
                            },
                          ),
                        ),
                      )
                      .toList(),
            ),
    );
  }

  // ==========================================================
  // ACTIVE SHIPMENTS
  // ==========================================================

  Widget _buildActiveShipments(
    BuildContext context,
    dynamic controller, {
    required bool isDesktop,
  }) {
    return Column(
      crossAxisAlignment:
          CrossAxisAlignment.start,

      children: [
        SectionHeader(
          title:
              AppLocalizations.of(
            context,
          )!.activeShipments,

          actionLabel:
              AppLocalizations.of(
            context,
          )!.seeAll,

          onActionTap: () =>
              controller.openOrders(
            tabIndex: 0,
          ),
        ),

        const SizedBox(
          height: 12,
        ),

        _activeOrders.isEmpty
            ? Container(
                width:
                    double.infinity,

                padding:
                    const EdgeInsets
                        .symmetric(
                  vertical: 28,
                ),

                child: Center(
                  child: Text(
                    AppLocalizations
                        .of(context)!
                        .noActiveShipments,

                    style:
                        Theme.of(
                      context,
                    )
                            .textTheme
                            .bodyMedium
                            ?.copyWith(
                          color:
                              TruxifyColors
                                  .adaptiveSecondaryText(
                            context,
                          ),
                        ),
                  ),
                ),
              )
            : SizedBox(
                height:
                    isDesktop
                        ? 190
                        : 175,

                child:
                    ListView.separated(
                  scrollDirection:
                      Axis.horizontal,

                  itemCount:
                      _activeOrders.length,

                  separatorBuilder:
                      (_, __) =>
                          const SizedBox(
                    width: 14,
                  ),

                  itemBuilder:
                      (context, index) {
                    final shipment =
                        _buildShipmentFromOrder(
                      _activeOrders[
                          index],
                    );

                    if (shipment ==
                        null) {
                      return const SizedBox
                          .shrink();
                    }

                    final orderId =
                        _activeOrders[
                                    index]
                                [
                                'display_id']
                            ?.toString() ??
                        _activeOrders[
                                    index]
                                ['id']
                            ?.toString() ??
                        '';

                    return SizedBox(
                      width:
                          isDesktop
                              ? 280
                              : 230,

                      child:
                          ShipmentCard(
                        shipment:
                            shipment,

                        onTap: orderId
                                .isNotEmpty
                            ? () =>
                                Navigator.of(
                                  context,
                                ).push(
                                AppPageRoute(
                                  builder:
                                      (_) =>
                                          LiveTrackingScreen(
                                    orderId:
                                        orderId,
                                  ),
                                ),
                              )
                            : () =>
                                _showComingSoon(
                              context,
                              'Live tracking',
                            ),
                      ),
                    );
                  },
                ),
              ),
      ],
    );
  }

  // ==========================================================
  // RECENT ROUTES
  // ==========================================================

  Widget _buildRecentRoutes(
    BuildContext context,
    dynamic controller,
  ) {
    return Column(
      crossAxisAlignment:
          CrossAxisAlignment.start,

      children: [
        SectionHeader(
          title:
              AppLocalizations.of(
            context,
          )!.yourUsualRoutes,

          actionLabel:
              _usualRoutes.isNotEmpty
                  ? 'View All'
                  : null,

          onActionTap:
              _usualRoutes.isNotEmpty
                  ? () =>
                      controller.openOrders(
                    tabIndex: 1,
                  )
                  : null,
        ),

        const SizedBox(
          height: 10,
        ),

        if (_usualRoutes.isEmpty)
          Padding(
            padding:
                const EdgeInsets.symmetric(
              vertical: 24,
            ),

            child: Center(
              child: Text(
                'No usual routes yet',

                style: Theme.of(
                  context,
                )
                    .textTheme
                    .bodyMedium
                    ?.copyWith(
                  color:
                      TruxifyColors
                          .adaptiveSecondaryText(
                    context,
                  ),
                ),
              ),
            ),
          )
        else
          ..._usualRoutes.map(
            (route) => Padding(
              padding:
                  const EdgeInsets.only(
                bottom: 10,
              ),

              child:
                  RecentRouteCard(
                route: route,

                onRebook: () {
                  controller
                      .openFindTrucks(
                    draft:
                        RouteDraft(
                      pickup:
                          route.pickup,

                      drop:
                          route.drop,

                      dateLabel:
                          '',

                      goodsType:
                          '',

                      weightTonnes:
                          '',

                      dimensions:
                          '',

                      stacked:
                          false,

                      fragile:
                          false,

                      requirements:
                          const [],

                      pickupLat:
                          route.pickupLat,

                      pickupLng:
                          route.pickupLng,

                      dropLat:
                          route.dropLat,

                      dropLng:
                          route.dropLng,
                    ),
                  );
                },
              ),
            ),
          ),
      ],
    );
  }
}

// ============================================================
// DASHBOARD STAT MODEL
// ============================================================

class _DashboardStat {
  const _DashboardStat({
    required this.title,
    required this.value,
    required this.icon,
  });

  final String title;
  final String value;
  final IconData icon;
}

// ============================================================
// ROUTE STATS
// ============================================================

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
