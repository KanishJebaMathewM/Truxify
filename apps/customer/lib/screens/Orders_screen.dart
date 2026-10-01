import 'package:flutter/material.dart';

import '../../models/app_models.dart';

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
