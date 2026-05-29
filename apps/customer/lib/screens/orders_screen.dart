import 'package:flutter/material.dart';
import 'package:freightfair/widgets/order_card.dart';

import '../controllers/app_controller.dart';
import '../data/mock_data.dart';
import '../widgets/app_page_route.dart';
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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tabController = _tabController!;

    return SafeArea(
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
            child: Row(
              children: [
                Text('Orders', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
                const Spacer(),
                IconButton(onPressed: () {}, icon: const Icon(Icons.search_rounded)),
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
                  itemCount: mockActiveOrders.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (context, index) {
                    final order = mockActiveOrders[index];
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
                  itemCount: mockHistoryOrders.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (context, index) {
                    final order = mockHistoryOrders[index];
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
