import 'package:flutter/material.dart';

import '../../models/app_models.dart';
import '../models/app_models.dart';
import '../services/order_service.dart';
import '../utils/driver_utils.dart';
import '../widgets/order_card.dart';
import 'live_tracking_screen.dart';
import 'order_detail_screen.dart';

class DesktopOrdersTable extends StatefulWidget {
  const DesktopOrdersTable({
    super.key,
    required this.orders,
    required this.onOrderTap,
  });

  final List<HistoryOrderData> orders;
  final ValueChanged<HistoryOrderData> onOrderTap;

  @override
  State<DesktopOrdersTable> createState() => _DesktopOrdersTableState();
}

class _DesktopOrdersTableState extends State<DesktopOrdersTable> {
  int? _sortColumnIndex;
  bool _sortAscending = true;

  Color _getStatusColor(String status) {
    switch (status.toLowerCase()) {
      case 'completed':
        return Colors.green;
      case 'cancelled':
        return Colors.red;
      case 'active':
        return Colors.blue;
      case 'pending':
        return Colors.orange;
      default:
        return Colors.grey;
    }
  }

  Widget _statusBadge(String status) {
    final color = _getStatusColor(status);

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 10,
        vertical: 6,
      ),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        status,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  void _sortByOrderId(int columnIndex, bool ascending) {
    setState(() {
      _sortColumnIndex = columnIndex;
      _sortAscending = ascending;

      widget.orders.sort((a, b) {
        final result = a.orderId.compareTo(b.orderId);
        return ascending ? result : -result;
      });
    });
  }

  void _sortByRoute(int columnIndex, bool ascending) {
    setState(() {
      _sortColumnIndex = columnIndex;
      _sortAscending = ascending;

      widget.orders.sort((a, b) {
        final result = a.route.compareTo(b.route);
        return ascending ? result : -result;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    if (widget.orders.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(40),
          child: Text(
            'No orders found',
            style: TextStyle(fontSize: 16),
          ),
        ),
      );
    }

    return Card(
      margin: EdgeInsets.zero,
      elevation: 0,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            sortColumnIndex: _sortColumnIndex,
            sortAscending: _sortAscending,
            showCheckboxColumn: false,

            columns: [
              DataColumn(
                label: const Text(
                  'Order ID',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                onSort: _sortByOrderId,
              ),
              DataColumn(
                label: const Text(
                  'Route',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                onSort: _sortByRoute,
              ),
              const DataColumn(
                label: Text(
                  'Vehicle',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const DataColumn(
                label: Text(
                  'Cargo',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const DataColumn(
                label: Text(
                  'Status',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const DataColumn(
                label: Text(
                  'Amount',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const DataColumn(
                label: Text(
                  'Actions',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],

            rows: widget.orders.map((order) {
              return DataRow(
                onSelectChanged: (_) {
                  widget.onOrderTap(order);
                },
                cells: [
                  DataCell(
                    Text(
                      order.orderId,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),

                  DataCell(
                    SizedBox(
                      width: 250,
                      child: Text(
                        order.route,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),

                  DataCell(
                    Text(order.truckNumber),
                  ),

                  DataCell(
                    Text(
                      order.goodsType ?? '—',
                    ),
                  ),

                  DataCell(
                    _statusBadge(order.status),
                  ),

                  DataCell(
                    Text(order.amount),
                  ),

                  DataCell(
                    IconButton(
                      tooltip: 'View order',
                      icon: const Icon(
                        Icons.visibility_outlined,
                      ),
                      onPressed: () {
                        widget.onOrderTap(order);
                      },
                    ),
                  ),
                ],
              );
            }).toList(),
          ),
        ),
      ),
    );
  }
}

/// Mobile orders screen: Active and History tabs backed by OrderService.
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key, this.orderService});

  /// Injectable for tests; defaults to a real OrderService.
  final OrderService? orderService;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen>
    with SingleTickerProviderStateMixin {
  late final OrderService _orderService;
  late final TabController _tabController;
  late final Future<List<Map<String, dynamic>>> _activeFuture;
  late final Future<List<Map<String, dynamic>>> _historyFuture;

  @override
  void initState() {
    super.initState();
    _orderService = widget.orderService ?? OrderService();
    _tabController = TabController(length: 2, vsync: this);
    _activeFuture = _orderService.fetchActiveOrders();
    _historyFuture = _orderService.fetchHistoryOrders();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  ActiveOrderData _toActiveOrder(Map<String, dynamic> order) {
    final status = order['status']?.toString() ?? '';
    return ActiveOrderData(
      orderId:
          order['order_display_id']?.toString() ?? order['id']?.toString() ?? '',
      route:
          '${order['pickup_address'] ?? ''} → ${order['drop_address'] ?? ''}',
      driver: DriverUtils.resolveDriverName(order),
      milestone: status,
      eta: order['eta']?.toString() ?? '',
      status: status,
    );
  }

  HistoryOrderData _toHistoryOrder(Map<String, dynamic> order) {
    final rawAmount = (order['total_amount'] as num?) ?? 0;
    return HistoryOrderData(
      orderId:
          order['order_display_id']?.toString() ?? order['id']?.toString() ?? '',
      route:
          '${order['pickup_address'] ?? ''} → ${order['drop_address'] ?? ''}',
      date: order['pickup_date']?.toString() ?? '',
      amount: '₹${(rawAmount / 100).toStringAsFixed(0)}',
      status: order['status']?.toString() ?? '',
      driver: DriverUtils.resolveDriverName(order),
      truckNumber: order['truck_number']?.toString() ?? '',
      timeline: const [],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
        children: [
          TabBar(
            controller: _tabController,
            tabs: const [
              Tab(text: 'Active'),
              Tab(text: 'History'),
            ],
          ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _OrdersTab(
                  future: _activeFuture,
                  builder: (orders) => ListView.builder(
                    itemCount: orders.length,
                    itemBuilder: (context, index) {
                      final raw = orders[index];
                      final active = _toActiveOrder(raw);
                      return ActiveOrderCard(
                        order: active,
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => LiveTrackingScreen(
                                orderId: raw['id']?.toString() ?? '',
                                orderService: _orderService,
                              ),
                            ),
                          );
                        },
                      );
                    },
                  ),
                ),
                _OrdersTab(
                  future: _historyFuture,
                  builder: (orders) => ListView.builder(
                    itemCount: orders.length,
                    itemBuilder: (context, index) {
                      final history = _toHistoryOrder(orders[index]);
                      return HistoryOrderCard(
                        order: history,
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => OrderDetailScreen(order: history),
                            ),
                          );
                        },
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ],
    );
  }
}

class _OrdersTab extends StatelessWidget {
  const _OrdersTab({required this.future, required this.builder});

  final Future<List<Map<String, dynamic>>> future;
  final Widget Function(List<Map<String, dynamic>> orders) builder;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        final orders = snapshot.data ?? const [];
        if (orders.isEmpty) {
          return const Center(child: Text('No orders yet'));
        }
        return builder(orders);
      },
    );
  }
}
