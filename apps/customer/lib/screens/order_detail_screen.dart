import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../constants/supabase_config.dart';
import '../controllers/app_controller.dart';
import '../models/app_models.dart';
import '../services/order_service.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import '../widgets/timeline_row.dart';

class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({super.key, required this.order});

  final HistoryOrderData order;

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  int _rating = 0;
  final TextEditingController _commentController = TextEditingController();
  late HistoryOrderData _currentOrder;
  final OrderService _orderService = OrderService();
  RealtimeChannel? _ordersChannel;
  bool _ratingDialogShown = false;

  @override
  void initState() {
    super.initState();
    _currentOrder = widget.order;
    _loadOrderAndTimeline();
    _subscribeToOrderUpdates();
  }

  @override
  void dispose() {
    _commentController.dispose();
    if (SupabaseConfig.isConfigured && _ordersChannel != null) {
      Supabase.instance.client.removeChannel(_ordersChannel!);
    }
    super.dispose();
  }

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

  String _formatTime(DateTime dateTime) {
    final hour = dateTime.hour.toString().padLeft(2, '0');
    final minute = dateTime.minute.toString().padLeft(2, '0');
    return '$hour:$minute';
  }

  Future<void> _loadOrderAndTimeline() async {
    try {
      final orderMap = await _orderService.fetchOrderById(_currentOrder.orderId);
      final timelineList = await _orderService.fetchOrderTimeline(_currentOrder.orderId);
      if (!mounted) return;

      if (orderMap != null) {
        setState(() {
          final rawAmount = orderMap['total_amount'] ?? 0;
          final amountInRupees = (rawAmount is num)
              ? (rawAmount / 100).toStringAsFixed(0)
              : rawAmount.toString();
          
          final driverName = _resolveDriverName(orderMap);
          final truckNumber = orderMap['truck_number']?.toString().trim().isNotEmpty == true
              ? orderMap['truck_number'].toString().trim()
              : '—';

          final parsedTimeline = timelineList.map((step) {
            final completed = step['completed'] == true;
            final updatedAt = step['updated_at']?.toString() ?? '';
            String timeStr = '';
            if (updatedAt.isNotEmpty) {
              final parsedDate = DateTime.tryParse(updatedAt);
              if (parsedDate != null) {
                timeStr = _formatTime(parsedDate.toLocal());
              }
            }
            return TimelineStepData(
              title: _formatStatus(step['milestone']?.toString() ?? ''),
              timestamp: timeStr,
              completed: completed,
            );
          }).toList();

          _currentOrder = HistoryOrderData(
            orderId: orderMap['order_display_id']?.toString() ?? _currentOrder.orderId,
            route: '${orderMap['pickup_address']} → ${orderMap['drop_address']}',
            date: orderMap['pickup_date']?.toString() ?? _currentOrder.date,
            amount: '₹$amountInRupees',
            status: _formatStatus(orderMap['status']?.toString() ?? 'pending'),
            driver: driverName,
            truckNumber: truckNumber,
            timeline: parsedTimeline,
            blockchainTxHash: orderMap['blockchain_tx_hash']?.toString(),
            baseFare: orderMap['base_fare'] != null ? '₹${(orderMap['base_fare'] as num / 100).toStringAsFixed(0)}' : null,
            distanceCharge: orderMap['distance_charge'] != null ? '₹${(orderMap['distance_charge'] as num / 100).toStringAsFixed(0)}' : null,
            tollCharge: orderMap['toll_charge'] != null ? '₹${(orderMap['toll_charge'] as num / 100).toStringAsFixed(0)}' : null,
            platformFee: orderMap['platform_fee'] != null ? '₹${(orderMap['platform_fee'] as num / 100).toStringAsFixed(0)}' : null,
          );

          // Trigger rating flow if status becomes completed and rating dialog hasn't been shown yet
          final orderStatus = orderMap['status']?.toString() ?? '';
          if (orderStatus == 'completed' || orderStatus == 'delivered' || orderStatus == 'payment_released') {
            _checkAndShowRatingDialog();
          }
        });
      }
    } catch (e) {
      debugPrint('Error loading order detail: $e');
    }
  }

  void _subscribeToOrderUpdates() {
    if (!SupabaseConfig.isConfigured) return;

    _ordersChannel = Supabase.instance.client
        .channel('order_detail_updates_${_currentOrder.orderId}')
        .onPostgresChanges(
          event: PostgresChangeEvent.update,
          schema: 'public',
          table: 'orders',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'order_display_id',
            value: _currentOrder.orderId,
          ),
          callback: (payload) {
            debugPrint('Realtime order detail update: ${payload.newRecord}');
            _loadOrderAndTimeline();
          },
        )
        .subscribe();
  }

  void _checkAndShowRatingDialog() {
    if (_ratingDialogShown) return;
    _ratingDialogShown = true;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _showRatingDialog();
    });
  }

  void _showRatingDialog() {
    int localRating = 0;
    final localCommentController = TextEditingController();

    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext dialogContext) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              title: const Text(
                'Rate Your Driver',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('How was your experience with the delivery?'),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(5, (index) {
                      final selected = index < localRating;
                      return IconButton(
                        onPressed: () {
                          setDialogState(() {
                            localRating = index + 1;
                          });
                        },
                        icon: Icon(
                          selected ? Icons.star_rounded : Icons.star_border_rounded,
                          color: Colors.amber,
                          size: 36,
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: localCommentController,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      hintText: 'Leave a comment (optional)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.of(dialogContext).pop();
                  },
                  child: const Text('Cancel'),
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: TruxifyColors.accentDark,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () {
                    if (localRating == 0) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Please select a rating.')),
                      );
                      return;
                    }
                    Navigator.of(dialogContext).pop();
                    setState(() {
                      _rating = localRating;
                      _commentController.text = localCommentController.text;
                    });
                    _submitRating();
                  },
                  child: const Text('Submit'),
                ),
              ],
            );
          },
        );
      },
    ).then((_) {
      localCommentController.dispose();
    });
  }

  void _submitRating() {
    if (_rating == 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a rating before submitting.')),
      );
      return;
    }

    final comment = _commentController.text.trim();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Thanks for your review! You submitted a $_rating-star rating${comment.isNotEmpty ? ' with a comment.' : '.'}',
        ),
      ),
    );
  }

  Future<void> _showReceipt() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Blockchain Receipt', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 10),
              const Text('Transaction hash'),
              const SizedBox(height: 6),
              SelectableText(_currentOrder.blockchainTxHash ?? 'Blockchain data pending'),
              const SizedBox(height: 16),
              PrimaryButton(label: 'Close', onPressed: () => Navigator.of(context).pop()),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final isSuccess = _currentOrder.status == 'Delivered' || _currentOrder.status == 'Payment Released';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Order Details'),
        leading: IconButton(onPressed: () => Navigator.of(context).pop(), icon: const Icon(Icons.arrow_back_rounded)),
        actions: [IconButton(onPressed: () {}, icon: const Icon(Icons.download_rounded))],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        children: [
          InfoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_currentOrder.orderId, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Text(_currentOrder.route, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context))),
                const SizedBox(height: 8),
                Text('Date: ${_currentOrder.date}', style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 8),
                StatusBadge(
                  label: isSuccess ? '✅ ${_currentOrder.status}' : '❌ Cancelled',
                  color: isSuccess ? TruxifyColors.accentDark : TruxifyColors.error,
                  filled: true,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          InfoCard(
            child: Row(
              children: [
                Container(
                  width: 54,
                  height: 54,
                  decoration: const BoxDecoration(color: TruxifyColors.accentLight, shape: BoxShape.circle),
                  child: const Icon(Icons.person_rounded, color: TruxifyColors.accentDark),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_currentOrder.driver, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 4),
                      Text('⭐ 4.8', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context))),
                      const SizedBox(height: 4),
                      Text(_currentOrder.truckNumber, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context))),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text('Timeline', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          ..._currentOrder.timeline.map(
            (step) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: TimelineRow(step: step),
            ),
          ),
          const SizedBox(height: 4),
          InfoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Price breakdown', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                if (_currentOrder.baseFare != null || _currentOrder.distanceCharge != null || _currentOrder.tollCharge != null || _currentOrder.platformFee != null) ...[
                  if (_currentOrder.baseFare != null)
                    _PriceLine(label: 'Base Fare', amount: _currentOrder.baseFare!),
                  if (_currentOrder.distanceCharge != null)
                    _PriceLine(label: 'Distance Charge', amount: _currentOrder.distanceCharge!),
                  if (_currentOrder.tollCharge != null)
                    _PriceLine(label: 'Toll Charges', amount: _currentOrder.tollCharge!),
                  if (_currentOrder.platformFee != null)
                    _PriceLine(label: 'Platform Fee', amount: _currentOrder.platformFee!),
                ],
                _PriceLine(label: 'Total', amount: _currentOrder.amount, isTotal: true),
              ],
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton(onPressed: _showReceipt, child: const Text('View Blockchain Receipt')),
          const SizedBox(height: 12),
          PrimaryButton(
            label: 'Rebook This Route',
            onPressed: () {
              final routeParts = _currentOrder.route.split(' → ');
              final pickup = routeParts.length == 2 ? routeParts.first : _currentOrder.route;
              final drop = routeParts.length == 2 ? routeParts.last : _currentOrder.route;

              TruxifyScope.of(context).openFindTrucks(
                draft: RouteDraft(
                  pickup: pickup,
                  drop: drop,
                  dateLabel: _currentOrder.date,
                  goodsType: 'Textile',
                  weightTonnes: '3',
                  dimensions: '12 × 6 × 6',
                  stacked: true,
                  fragile: false,
                  requirements: const ['Loading help needed'],
                ),
              );
            },
          ),
          const SizedBox(height: 18),
          if (isSuccess) ...[
            Text('Rate your driver', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            Row(
              children: List.generate(5, (index) {
                final selected = index < _rating;
                return IconButton(
                  onPressed: () => setState(() => _rating = index + 1),
                  icon: Icon(selected ? Icons.star_rounded : Icons.star_border_rounded, color: Colors.amber, size: 30),
                );
              }),
            ),
            const SizedBox(height: 8),
            TextField(controller: _commentController, maxLines: 3, decoration: const InputDecoration(labelText: 'Comment')),
            const SizedBox(height: 12),
            PrimaryButton(label: 'Submit Rating', onPressed: _submitRating),
          ],
        ],
      ),
    );
  }
}

class _PriceLine extends StatelessWidget {
  const _PriceLine({required this.label, required this.amount, this.isTotal = false});

  final String label;
  final String amount;
  final bool isTotal;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Text(label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: isTotal ? FontWeight.w800 : FontWeight.w500)),
          const Spacer(),
          Text(amount, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: isTotal ? FontWeight.w800 : FontWeight.w600)),
        ],
      ),
    );
  }
}

