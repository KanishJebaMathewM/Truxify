import 'package:flutter/material.dart';
import 'package:truxify/widgets/order_card.dart';

import '../controllers/app_controller.dart';
import '../data/mock_data.dart';
import '../models/app_models.dart';
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
  TabController? _tabController;
  TruxifyController? _controller;
  final TextEditingController _searchController = TextEditingController();
  bool _isSearching = false;
  String _searchQuery = '';

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final controller = TruxifyScope.of(context);
    if (_tabController == null) {
      _controller = controller;
      _tabController = TabController(length: 2, vsync: this, initialIndex: controller.ordersTabIndex);
      _tabController!.addListener(() {
        if (!_tabController!.indexIsChanging) {
          _controller?.setOrdersTab(_tabController!.index);
        }
      });
    } else if (_tabController!.index != controller.ordersTabIndex && !_tabController!.indexIsChanging) {
      _tabController!.animateTo(controller.ordersTabIndex);
    }
  }

  @override
  void dispose() {
    _tabController?.dispose();
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
      return mockActiveOrders;
    }
    return mockActiveOrders.where((order) {
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
      return mockHistoryOrders;
    }
    return mockHistoryOrders.where((order) {
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
    final tabController = _tabController;
    if (tabController == null) {
      return const SizedBox.shrink();
    }

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
              controller: tabController,
              tabs: const [Tab(text: 'Active'), Tab(text: 'History')],
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: tabController,
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
