import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../constants/supabase_config.dart';
import '../controllers/app_controller.dart';
import '../l10n/app_localizations.dart';
import '../models/app_models.dart';
import '../services/invoice_pdf_service.dart';
import '../services/order_service.dart';
import '../services/tracking_service.dart';
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
  final TrackingService _trackingService = TrackingService();
  RealtimeChannel? _ordersChannel;
  bool _ratingDialogShown = false;
  bool _isGeneratingInvoice = false;
  bool _isSubmittingRating = false;
  bool _ratingSubmitted = false;

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

  String? _formatRupeesFromPaise(dynamic value) {
    if (value is! num) return null;
    return '₹ ${(value / 100).toStringAsFixed(0)}';
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
            route: '${orderMap['pickup_address'] ?? 'Unknown'} → ${orderMap['drop_address'] ?? 'Unknown'}',
            date: orderMap['pickup_date']?.toString() ?? _currentOrder.date,
            amount: '₹$amountInRupees',
            status: _formatStatus(orderMap['status']?.toString() ?? 'pending'),
            driver: driverName,
            truckNumber: truckNumber,
            timeline: parsedTimeline,
            blockchainTxHash: orderMap['blockchain_tx_hash']?.toString(),
            baseFare: _formatRupeesFromPaise(orderMap['base_fare']),
            distanceCharge: _formatRupeesFromPaise(orderMap['distance_charge']),
            tollCharge: _formatRupeesFromPaise(orderMap['toll_charge']),
            platformFee: _formatRupeesFromPaise(orderMap['platform_fee']),
            driverPhone: orderMap['driver_phone']?.toString() ??
                (orderMap['profiles'] is Map<String, dynamic>
                    ? orderMap['profiles']['phone']?.toString()
                    : null),
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

  Future<void> _submitRating() async {
    if (_rating == 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a rating before submitting.')),
      );
      return;
    }

    if (_isSubmittingRating) return;

    setState(() => _isSubmittingRating = true);

    try {
      final comment = _commentController.text.trim();
      await _orderService.submitRating(
        orderId: _currentOrder.orderId,
        stars: _rating,
        comment: comment.isNotEmpty ? comment : null,
      );

      if (!mounted) return;

      setState(() {
        _ratingSubmitted = true;
        _isSubmittingRating = false;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Rating submitted successfully!'),
          backgroundColor: TruxifyColors.success,
        ),
      );
    } on StateError catch (e) {
      if (!mounted) return;

      final message = e.message;

      if (message.contains('409') || message.toLowerCase().contains('already')) {
        setState(() {
          _ratingSubmitted = true;
          _isSubmittingRating = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('You have already rated this order.'),
          ),
        );
        return;
      }

      setState(() => _isSubmittingRating = false);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to submit rating: $message'),
          backgroundColor: TruxifyColors.error,
          action: SnackBarAction(
            label: 'Retry',
            textColor: Colors.white,
            onPressed: _submitRating,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;

      setState(() => _isSubmittingRating = false);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('An unexpected error occurred: $e'),
          backgroundColor: TruxifyColors.error,
          action: SnackBarAction(
            label: 'Retry',
            textColor: Colors.white,
            onPressed: _submitRating,
          ),
        ),
      );
    }
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

  Future<void> _shareTracking() async {
    try {
      final result = await _trackingService.shareTrackingLink(
        orderDisplayId: _currentOrder.orderId,
      );

      final trackingUrl = result['trackingUrl'] as String?;
      if (trackingUrl == null || trackingUrl.isEmpty) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(AppLocalizations.of(context)!.unableToShare)),
        );
        return;
      }

      if (!mounted) return;
      await Share.share(
        'Track your shipment on Truxify:\n$trackingUrl',
        subject: 'Shipment Tracking - ${_currentOrder.orderId}',
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${AppLocalizations.of(context)!.unableToShare}: $e')),
      );
    }
  }

  Future<void> _generateInvoice() async {
    if (_isGeneratingInvoice) return;

    setState(() => _isGeneratingInvoice = true);

    try {
      await InvoicePdfService.printOrShareInvoice(_currentOrder);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.invoiceReady),
          backgroundColor: TruxifyColors.success,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${AppLocalizations.of(context)!.downloadFailed}: $e'),
          backgroundColor: TruxifyColors.error,
        ),
      );
    } finally {
      if (mounted) setState(() => _isGeneratingInvoice = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isSuccess = _currentOrder.status == 'Delivered' || _currentOrder.status == 'Payment Released';
    final isCancelled = _currentOrder.status == 'Cancelled';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Order Details'),
        leading: IconButton(onPressed: () => Navigator.of(context).pop(), icon: const Icon(Icons.arrow_back_rounded)),
        actions: [
          IconButton(onPressed: _shareTracking, icon: const Icon(Icons.share_rounded)),
          if (_isGeneratingInvoice)
            const Padding(
              padding: EdgeInsets.all(12),
              child: SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2.5),
              ),
            )
          else
            IconButton(
              onPressed: _generateInvoice,
              icon: const Icon(Icons.download_rounded),
            ),
        ],
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
                if (_currentOrder.requiresRefrigeration) ...[
                  Row(
                    children: [
                      const Icon(Icons.ac_unit_rounded, size: 16, color: Colors.blue),
                      const SizedBox(width: 4),
                      Text('Temperature: ${_currentOrder.targetTemperatureMin ?? '?'}°C to ${_currentOrder.targetTemperatureMax ?? '?'}°C', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Colors.blue)),
                    ],
                  ),
                  const SizedBox(height: 8),
                ],
                StatusBadge(
                  label: isSuccess ? '✅ ${_currentOrder.status}' : isCancelled ? '❌ Cancelled' : '🔄 ${_currentOrder.status}',
                  color: isSuccess ? TruxifyColors.accentDark : isCancelled ? TruxifyColors.error : TruxifyColors.warning,
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
                  requirements: _currentOrder.specialRequirements != null && _currentOrder.specialRequirements!.isNotEmpty
          ? [_currentOrder.specialRequirements!]
          : const [],
                ),
              );
            },
          ),
          const SizedBox(height: 18),
          if (isSuccess) ...[
            if (_ratingSubmitted) ...[
              Text('Your Rating', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 10),
              InfoCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        ...List.generate(5, (index) {
                          return Icon(
                            index < _rating ? Icons.star_rounded : Icons.star_border_rounded,
                            color: Colors.amber,
                            size: 28,
                          );
                        }),
                        const SizedBox(width: 8),
                        Text('$_rating/5', style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                      ],
                    ),
                    if (_commentController.text.trim().isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(_commentController.text.trim(), style: Theme.of(context).textTheme.bodyMedium),
                    ],
                    const SizedBox(height: 8),
                    Text(
                      'You have already rated this order.',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: TruxifyColors.adaptiveSecondaryText(context),
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ],
                ),
              ),
            ] else ...[
              Text('Rate your driver', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 10),
              Row(
                children: List.generate(5, (index) {
                  final selected = index < _rating;
                  return IconButton(
                    onPressed: _isSubmittingRating ? null : () => setState(() => _rating = index + 1),
                    icon: Icon(selected ? Icons.star_rounded : Icons.star_border_rounded, color: Colors.amber, size: 30),
                  );
                }),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _commentController,
                maxLines: 3,
                decoration: const InputDecoration(labelText: 'Comment'),
                enabled: !_isSubmittingRating,
              ),
              const SizedBox(height: 12),
              if (_isSubmittingRating)
                const SizedBox(
                  width: double.infinity,
                  child: Center(child: Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5)),
                  )),
                )
              else
                PrimaryButton(label: 'Submit Rating', onPressed: _submitRating),
            ],
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

