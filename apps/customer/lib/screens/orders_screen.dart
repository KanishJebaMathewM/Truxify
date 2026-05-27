import 'package:flutter/material.dart';

import '../controllers/app_controller.dart';
import '../data/mock_data.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_page_route.dart';
import '../widgets/common_widgets.dart';
import 'live_tracking_screen.dart';
import 'order_detail_screen.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> with SingleTickerProviderStateMixin {
  TabController? _tabController;
  FreightFairController? _controller;
  bool _isSearching = false;
  final TextEditingController _searchController = TextEditingController();

  List<ActiveOrderData> get _filteredActiveOrders {
    final query = _searchController.text.toLowerCase().trim();
    if (query.isEmpty) return mockActiveOrders;
    return mockActiveOrders.where((o) =>
      o.orderId.toLowerCase().contains(query) ||
      o.route.toLowerCase().contains(query)
    ).toList();
  }

  List<HistoryOrderData> get _filteredHistoryOrders {
    final query = _searchController.text.toLowerCase().trim();
    if (query.isEmpty) return mockHistoryOrders;
    return mockHistoryOrders.where((o) =>
      o.orderId.toLowerCase().contains(query) ||
      o.route.toLowerCase().contains(query)
    ).toList();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final controller = FreightFairScope.of(context);
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
        _searchController.clear();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final tabController = _tabController!;
    final activeOrders = _filteredActiveOrders;
    final historyOrders = _filteredHistoryOrders;

    return SafeArea(
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
            child: _isSearching
                ? TextField(
                    controller: _searchController,
                    autofocus: true,
                    decoration: InputDecoration(
                      hintText: 'Search by order ID or route…',
                      prefixIcon: const Icon(Icons.search_rounded),
                      suffixIcon: IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: _toggleSearch,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      contentPadding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    onChanged: (_) => setState(() {}),
                  )
                : Row(
                    children: [
                      Text('Orders', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
                      const Spacer(),
                      IconButton(onPressed: _toggleSearch, icon: const Icon(Icons.search_rounded)),
                    ],
                  ),
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
                  itemCount: activeOrders.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (context, index) {
                    final order = activeOrders[index];
                    return _ActiveOrderCard(
                      order: order,
                      onTap: () => Navigator.of(context).push(
                        AppPageRoute(builder: (_) => LiveTrackingScreen(orderId: order.orderId)),
                      ),
                    );
                  },
                ),
                ListView.separated(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
                  itemCount: historyOrders.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (context, index) {
                    final order = historyOrders[index];
                    return _HistoryOrderCard(
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

class _ActiveOrderCard extends StatelessWidget {
  const _ActiveOrderCard({required this.order, required this.onTap});

  final ActiveOrderData order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: InfoCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(order.orderId, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                ),
                StatusBadge(label: order.milestone, color: FreightFairColors.accent, filled: true),
              ],
            ),
            const SizedBox(height: 10),
            Text(order.route, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: FreightFairColors.adaptiveSecondaryText(context))),
            const SizedBox(height: 8),
            Text('Driver: ${order.driver}', style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('ETA: ${order.eta}', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: FreightFairColors.adaptiveSecondaryText(context))),
            const SizedBox(height: 14),
            PrimaryButton(label: 'Track Live', onPressed: onTap),
          ],
        ),
      ),
    );
  }
}

class _HistoryOrderCard extends StatelessWidget {
  const _HistoryOrderCard({required this.order, required this.onTap});

  final HistoryOrderData order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final statusColor = order.status == 'Delivered' ? FreightFairColors.accentDark : FreightFairColors.error;
    return GestureDetector(
      onTap: onTap,
      child: InfoCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(order.route, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                ),
                Text(order.date, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: FreightFairColors.adaptiveSecondaryText(context))),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Text(order.amount, style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: Theme.of(context).brightness == Brightness.dark
                      ? FreightFairColors.accent
                      : FreightFairColors.accentDark,
                )),
                const SizedBox(width: 10),
                StatusBadge(label: order.status == 'Delivered' ? '✅ Delivered' : '❌ Cancelled', color: statusColor, filled: true),
              ],
            ),
            const SizedBox(height: 12),
            Text('Driver: ${order.driver}', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: FreightFairColors.adaptiveSecondaryText(context))),
            const SizedBox(height: 14),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton(
                onPressed: onTap,
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 42), padding: const EdgeInsets.symmetric(horizontal: 14)),
                child: const Text('View Details'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
