import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify/widgets/order_card.dart';
import '../constants/supabase_config.dart';
import '../l10n/app_localizations.dart';
import '../services/order_service.dart';
import '../services/supabase_service.dart';
import '../controllers/app_controller.dart';
import '../core/offline/cache/cache_manager.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_page_route.dart';
import '../widgets/order_search_bar.dart';
import 'live_tracking_screen.dart';
import 'order_detail_screen.dart';
import 'package:flutter/foundation.dart';
import 'package:truxify_shared/shimmer_widget.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen>
    with SingleTickerProviderStateMixin {
  late final OrderService _orderService;
  late final TabController _tabController;
  TruxifyController? _controller;
  final TextEditingController _searchController = TextEditingController();
  bool _isSearching = false;
  String _searchQuery = '';
  final CacheManager _cacheManager = CacheManager();
  bool _isOffline = false;
  String? _lastUpdatedLabel;
  List<ActiveOrderData> _activeOrders = [];
  List<HistoryOrderData> _historyOrders = [];
  bool _isLoading = true;

  String _formatStatus(String status) {
    switch (status) {
      case 'driver_assigned':
        return 'Driver Assigned';
      case 'in_transit':
        return 'In Transit';
      case 'payment_released':
        return 'Payment Released';
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
            .map((word) => word.isEmpty
                ? word
                : '${word[0].toUpperCase()}${word.substring(1)}')
            .join(' ');
    }
  }

  @override
  void initState() {
    super.initState();

    _orderService = OrderService();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        _controller?.setOrdersTab(_tabController.index);
      }
    });
    _loadOrders();
    _subscribeToOrdersListUpdates();
  }

  String _formatLastUpdated(String? updatedAt) {
    if (updatedAt == null || updatedAt.isEmpty) {
      return 'just now';
    }

    final lastUpdated = DateTime.tryParse(updatedAt);
    if (lastUpdated == null) {
      return 'just now';
    }

    final minutes = DateTime.now().difference(lastUpdated).inMinutes;
    if (minutes < 1) return 'just now';
    if (minutes == 1) return '1 min ago';
    return '$minutes mins ago';
  }

  String _resolveDriverName(Map<String, dynamic> order) {
    final profile = order['profiles'];
    if (profile is Map<String, dynamic>) {
      final name = profile['full_name']?.toString().trim();
      if (name != null && name.isNotEmpty) return name;
    }

    final driverName = order['driver_name']?.toString().trim();
    if (driverName != null && driverName.isNotEmpty) return driverName;

    return 'Driver Assigned';
  }

  Future<void> _loadOrders() async {
    setState(() {
      _isLoading = true;
    });

    final connectivity = await Connectivity().checkConnectivity();
    final hasNetwork = connectivity.isNotEmpty &&
        !connectivity.contains(ConnectivityResult.none);

    if (!kIsWeb) {
      await _cacheManager.open();
    }

    try {
      if (hasNetwork) {
        final activeOrders = await _orderService.fetchActiveOrders();
        debugPrint("Supabase active orders: $activeOrders");
        final historyOrders = await _orderService.fetchHistoryOrders();
        debugPrint("Supabase history orders: $historyOrders");

        String? updatedAt;

        if (!kIsWeb) {
          await _cacheManager.cacheOrders([
            ...activeOrders,
            ...historyOrders,
          ]);

          updatedAt = await _cacheManager.getLastUpdatedLabel('orders');
        }

        if (!mounted) return;

        setState(() {
          _isOffline = false;
          _isLoading = false;
          _lastUpdatedLabel = updatedAt;

          _activeOrders = activeOrders.map((order) {
            return ActiveOrderData(
              orderId: order['order_display_id']?.toString() ?? '',
              route:
                  '${order['pickup_address']} → ${order['drop_address']}',
              driver: _resolveDriverName(order),
              milestone:
                  _formatStatus(order['status']?.toString() ?? 'pending'),
              eta: order['eta']?.toString() ?? '',
              status:
                  _formatStatus(order['status']?.toString() ?? 'pending'),
            );
          }).toList();

          _historyOrders = historyOrders.map((order) {
            final rawAmount = order['total_amount'] ?? 0;
            final amountInRupees = (rawAmount is num)
                ? (rawAmount / 100).toStringAsFixed(0)
                : rawAmount.toString();
            return HistoryOrderData(
              orderId: order['order_display_id']?.toString() ?? '',
              route:
                  '${order['pickup_address']} → ${order['drop_address']}',
              date: order['pickup_date']?.toString() ?? '',
              amount: '₹$amountInRupees',
              status: _formatStatus(
                  order['status']?.toString() ?? 'completed'),
              driver: _resolveDriverName(order),
              truckNumber: order['truck_number']?.toString().trim().isNotEmpty == true
                  ? order['truck_number'].toString().trim()
                  : '—',
              timeline: const [],
              goodsType: order['goods_type']?.toString(),
              weightTonnes: order['weight_tonnes']?.toString(),
              dimensions: (order['length_ft'] != null && order['width_ft'] != null && order['height_ft'] != null)
                  ? '${order['length_ft']} × ${order['width_ft']} × ${order['height_ft']}'
                  : null,
              isStackable: order['is_stackable'] as bool?,
              isFragile: order['is_fragile'] as bool?,
              specialRequirements: order['special_requirements']?.toString(),
            );
          }).toList();
        });
      } else {
        if (!kIsWeb) {
          final cachedOrders = await _cacheManager.getOrders(limit: 50);
          final updatedAt =
              await _cacheManager.getLastUpdatedLabel('orders');

          if (!mounted) return;

          const activeStatuses = {
            'pending',
            'active',
            'driver_assigned',
            'truck_assigned',
            'en_route_pickup',
            'arrived_pickup',
            'picked_up',
            'in_transit',
            'arriving',
          };

          final activeRaw = cachedOrders
              .where((o) => activeStatuses.contains(o['status']?.toString()))
              .toList();
          final historyRaw = cachedOrders
              .where((o) => !activeStatuses.contains(o['status']?.toString()))
              .toList();

          setState(() {
            _isOffline = true;
            _isLoading = false;
            _lastUpdatedLabel = updatedAt;

            _activeOrders = activeRaw.map((order) {
              return ActiveOrderData(
                orderId: order['order_display_id']?.toString() ?? '',
                route:
                    '${order['pickup_address']} → ${order['drop_address']}',
                driver: _resolveDriverName(order),
                milestone:
                    _formatStatus(order['status']?.toString() ?? 'pending'),
                eta: order['eta']?.toString() ?? '',
                status:
                    _formatStatus(order['status']?.toString() ?? 'pending'),
              );
            }).toList();

            _historyOrders = historyRaw.map((order) {
              final rawAmount = order['total_amount'] ?? 0;
              final amountInRupees = (rawAmount is num)
                  ? (rawAmount / 100).toStringAsFixed(0)
                  : rawAmount.toString();
              return HistoryOrderData(
                orderId: order['order_display_id']?.toString() ?? '',
                route:
                    '${order['pickup_address']} → ${order['drop_address']}',
                date: order['pickup_date']?.toString() ?? '',
                amount: '₹$amountInRupees',
                status: _formatStatus(
                    order['status']?.toString() ?? 'completed'),
                driver: _resolveDriverName(order),
                truckNumber: order['truck_number']?.toString().trim().isNotEmpty == true
                    ? order['truck_number'].toString().trim()
                    : '—',
                timeline: const [],
                goodsType: order['goods_type']?.toString(),
                weightTonnes: order['weight_tonnes']?.toString(),
                dimensions: (order['length_ft'] != null && order['width_ft'] != null && order['height_ft'] != null)
                    ? '${order['length_ft']} × ${order['width_ft']} × ${order['height_ft']}'
                    : null,
                isStackable: order['is_stackable'] as bool?,
                isFragile: order['is_fragile'] as bool?,
                specialRequirements: order['special_requirements']?.toString(),
              );
            }).toList();
          });
        } else {
          if (!mounted) return;

          setState(() {
            _isOffline = true;
            _isLoading = false;
          });
        }
      }
    } catch (e) {
      debugPrint('Failed to load orders: $e');
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final controller = TruxifyScope.of(context);
    _controller = controller;

    if (_tabController.index != controller.ordersTabIndex &&
        !_tabController.indexIsChanging) {
      _tabController.animateTo(controller.ordersTabIndex);
    }
    _loadOrders();
  }

  RealtimeChannel? _ordersChannel;

  void _subscribeToOrdersListUpdates() {
    if (!SupabaseConfig.isConfigured) return;
    
    final userId = SupabaseService.currentUserId;
    if (userId == null) return;

    _ordersChannel = Supabase.instance.client
        .channel('customer_orders_list_$userId')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'orders',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'customer_id',
            value: userId,
          ),
          callback: (payload) {
            debugPrint('Realtime customer orders list update: ${payload.newRecord}');
            _loadOrders();
          },
        )
        .subscribe();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    if (SupabaseConfig.isConfigured && _ordersChannel != null) {
      Supabase.instance.client.removeChannel(_ordersChannel!);
    }
    super.dispose();
  }

  void _toggleSearch() {
    setState(() {
      _isSearching = !_isSearching;
      if (!_isSearching) {
        _searchQuery = '';
        _searchController.clear();
      }
    });
  }

  void _onSearchChanged(String value) {
    setState(() {
      _searchQuery = value;
    });
  }

  List<ActiveOrderData> get _filteredActiveOrders {
    final query = _searchQuery.trim().toLowerCase();
    if (query.isEmpty) {
      return _activeOrders;
    }
    return _activeOrders.where((order) {
      return _orderMatches(query, [
        order.orderId,
        order.route,
        order.driver,
        order.milestone,
        order.status,
        order.eta,
      ]);
    }).toList();
  }

  List<HistoryOrderData> get _filteredHistoryOrders {
    final query = _searchQuery.trim().toLowerCase();
    if (query.isEmpty) {
      return _historyOrders;
    }
    return _historyOrders.where((order) {
      return _orderMatches(query, [
        order.orderId,
        order.route,
        order.driver,
        order.date,
        order.amount,
        order.status,
        order.truckNumber,
      ]);
    }).toList();
  }

  bool _orderMatches(String query, List<String> fields) {
    return fields.any((value) => value.toLowerCase().contains(query));
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(
        children: [
          OrderSearchBar(
            title: AppLocalizations.of(context)!.orders,
            isSearching: _isSearching,
            onToggle: _toggleSearch,
            controller: _searchController,
            onChanged: _onSearchChanged,
            searchQuery: _searchQuery,
            hintText: AppLocalizations.of(context)!.searchOrdersHint,
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
            child: TabBar(
              controller: _tabController,
              tabs: [Tab(text: AppLocalizations.of(context)!.activeTab), Tab(text: AppLocalizations.of(context)!.historyTab)],
            ),
          ),
          if (_isOffline)
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 0),
              child: Text(
                '${AppLocalizations.of(context)!.offlineMode} \u2022 ${AppLocalizations.of(context)!.lastUpdated(_formatLastUpdated(_lastUpdatedLabel))}',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: TruxifyColors.accentDark),
              ),
            ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                RefreshIndicator(
                  onRefresh: _loadOrders,
                  child: _isLoading
                      ? ListView.separated(
                          padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
                          itemCount: 3,
                          separatorBuilder: (_, __) => const SizedBox(height: 14),
                          itemBuilder: (context, index) => const ShimmerOrderCard(),
                        )
                      : _filteredActiveOrders.isEmpty
                          ? Center(child: Text(AppLocalizations.of(context)!.noActiveOrders))
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
                              itemCount: _filteredActiveOrders.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 14),
                              itemBuilder: (context, index) {
                                final order = _filteredActiveOrders[index];
                                return ActiveOrderCard(
                                  order: order,
                                  onTap: () => Navigator.of(context).push(
                                    AppPageRoute(
                                      builder: (_) =>
                                          LiveTrackingScreen(orderId: order.orderId),
                                    ),
                                  ),
                                );
                              },
                            ),
                ),
                RefreshIndicator(
                  onRefresh: _loadOrders,
                  child: _isLoading
                      ? ListView.separated(
                          padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
                          itemCount: 3,
                          separatorBuilder: (_, __) => const SizedBox(height: 14),
                          itemBuilder: (context, index) => const ShimmerOrderCard(),
                        )
                      : _filteredHistoryOrders.isEmpty
                          ? Center(child: Text(AppLocalizations.of(context)!.noHistoryOrders))
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
                              itemCount: _filteredHistoryOrders.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 14),
                              itemBuilder: (context, index) {
                                final order = _filteredHistoryOrders[index];
                                return HistoryOrderCard(
                                  order: order,
                                  onTap: () => Navigator.of(context).push(
                                    AppPageRoute(
                                      builder: (_) =>
                                          OrderDetailScreen(order: order),
                                    ),
                                  ),
                                );
                              },
                            ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
