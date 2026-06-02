import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:truxify/widgets/order_card.dart';

import '../constants/app_colors.dart';
import '../controllers/app_controller.dart';
import '../core/offline/cache/cache_manager.dart';
import '../data/mock_data.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_page_route.dart';
import '../widgets/order_search_bar.dart';
import 'live_tracking_screen.dart';
import 'order_detail_screen.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  TruxifyController? _controller;
  final TextEditingController _searchController = TextEditingController();
  bool _isSearching = false;
  String _searchQuery = '';
  final CacheManager _cacheManager = CacheManager();
  bool _isOffline = false;
  String? _lastUpdatedLabel;
  List<ActiveOrderData> _activeOrders = List<ActiveOrderData>.from(mockActiveOrders);
  List<HistoryOrderData> _historyOrders = List<HistoryOrderData>.from(mockHistoryOrders);

  @override
  void initState() {
        _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        _controller?.setOrdersTab(_tabController.index);
      }
    });
    _loadOrders();
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

  Future<void> _loadOrders() async {
    final connectivity = await Connectivity().checkConnectivity();
    final hasNetwork = connectivity != ConnectivityResult.none;
    await _cacheManager.open();

    await _cacheManager.cacheOrders(
      [
        ...mockActiveOrders.map((order) => {
          'id': order.orderId,
          'status': 'active',
          'route': order.route,
          'driver': order.driver,
          'milestone': order.milestone,
          'eta': order.eta,
        }),
        ...mockHistoryOrders.map((order) => {
          'id': order.orderId,
          'status': order.status.toLowerCase(),
          'route': order.route,
          'amount': order.amount,
          'date': order.date,
          'driver': order.driver,
          'truckNumber': order.truckNumber,
        }),
      ],
    );

    for (final order in <dynamic>[...mockActiveOrders, ...mockHistoryOrders]) {
      final orderId = order.orderId as String;
      final historyOrder = mockHistoryOrders.where((item) => item.orderId == orderId).firstOrNull;
      final timeline = (historyOrder?.timeline ?? const []).map((step) => {
        'title': step.title,
        'completed': step.completed,
      }).toList();
      if (timeline.isNotEmpty) {
        await _cacheManager.cacheMilestones(orderId, timeline);
      }
    }

    final cachedOrders = await _cacheManager.getOrders(limit: 50);
    final updatedAt = await _cacheManager.getLastUpdatedLabel('orders');
    if (!mounted) return;

    setState(() {
      _isOffline = !hasNetwork;
      _lastUpdatedLabel = updatedAt;
      if (!hasNetwork && cachedOrders.isNotEmpty) {
        _activeOrders = cachedOrders
            .where((item) => item['status'] == 'active' || item['status'] == 'in_transit')
            .map((item) => ActiveOrderData(
                  orderId: item['id']?.toString() ?? '#FF000000',
                  route: item['route']?.toString() ?? 'Unknown route',
                  driver: item['driver']?.toString() ?? 'Driver unavailable',
                  milestone: item['milestone']?.toString() ??
                      (mockHistoryOrders.where((entry) => entry.orderId == item['id']).firstOrNull?.timeline.lastOrNull?.title ?? 'In Transit'),
                  eta: item['eta']?.toString() ?? 'Today',
                  status: item['status']?.toString() ?? 'Active',
                ))
            .toList();
        _historyOrders = cachedOrders
            .where((item) => item['status'] != 'active' && item['status'] != 'in_transit')
            .map((item) => HistoryOrderData(
                  orderId: item['id']?.toString() ?? '#FF000000',
                  route: item['route']?.toString() ?? 'Unknown route',
                  date: item['date']?.toString() ?? '',
                  amount: item['amount']?.toString() ?? '₹0',
                  status: item['status']?.toString() == 'delivered' ? 'Delivered' : 'Cancelled',
                  driver: item['driver']?.toString() ?? 'Driver unavailable',
                  truckNumber: item['truckNumber']?.toString() ?? '',
                  timeline: const [],
                ))
            .toList();
      }
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final controller = TruxifyScope.of(context);
    _controller = controller;

    if (_tabController.index != controller.ordersTabIndex && !_tabController.indexIsChanging) {
      _tabController.animateTo(controller.ordersTabIndex);
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
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
            title: 'Orders',
            isSearching: _isSearching,
            onToggle: _toggleSearch,
            controller: _searchController,
            onChanged: _onSearchChanged,
            searchQuery: _searchQuery,
            hintText: 'Search by order ID, route, driver or status',
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
            child: TabBar(
              controller: _tabController,
              tabs: const [Tab(text: 'Active'), Tab(text: 'History')],
            ),
          ),
          if (_isOffline)
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 0),
              child: Text(
                'Offline mode • Last updated ${_formatLastUpdated(_lastUpdatedLabel)}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: TruxifyColors.accentDark),
              ),
            ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                ListView.separated(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
                  itemCount: _filteredActiveOrders.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (context, index) {
                    final order = _filteredActiveOrders[index];
                    return ActiveOrderCard(
                      order: order,
                      onTap: () => Navigator.of(context).push(
                        AppPageRoute(builder: (_) => LiveTrackingScreen(orderId: order.orderId)),
                      ),
                    );
                  },
                ),
                ListView.separated(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
                  itemCount: _filteredHistoryOrders.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (context, index) {
                    final order = _filteredHistoryOrders[index];
                    return HistoryOrderCard(
                      order: order,
                      onTap: () => Navigator.of(context).push(
                        AppPageRoute(builder: (_) => OrderDetailScreen(order: order)),
                      ),
                    );
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
