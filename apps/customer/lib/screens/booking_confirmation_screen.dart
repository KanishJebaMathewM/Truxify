import 'package:flutter/material.dart';
import '../services/order_service.dart';
import '../controllers/app_controller.dart';
import '../data/mock_data.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class BookingConfirmationScreen extends StatefulWidget {
  const BookingConfirmationScreen(
      {super.key, required this.draft, required this.truck});

  final RouteDraft draft;
  final TruckResultData truck;

  @override
  State<BookingConfirmationScreen> createState() =>
      _BookingConfirmationScreenState();
}

class _BookingConfirmationScreenState extends State<BookingConfirmationScreen>
    with SingleTickerProviderStateMixin {
  final TextEditingController _upiController =
      TextEditingController(text: 'karthik@upi');
  bool _showSuccess = false;
  String? _createdOrderId;
  late final AnimationController _controller;
  late final OrderService _orderService;

  @override
  void initState() {
    super.initState();
    _orderService = OrderService();
    _controller = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 600));
  }

  @override
  void dispose() {
    _upiController.dispose();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _pay() async {
    if (widget.draft.pickupLat == null ||
        widget.draft.pickupLng == null ||
        widget.draft.dropLat == null ||
        widget.draft.dropLng == null) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Missing pickup or drop coordinates. Please go back and select valid locations.')),
      );
      return;
    }

    try {
      final orderId = await _orderService.createOrder(
        pickupAddress: widget.draft.pickup,
        dropAddress: widget.draft.drop,
        pickupLat: widget.draft.pickupLat!,
        pickupLng: widget.draft.pickupLng!,
        dropLat: widget.draft.dropLat!,
        dropLng: widget.draft.dropLng!,
        pickupTime: widget.draft.dateLabel,
        goodsType: widget.draft.goodsType,
        weightTonnes: double.tryParse(widget.draft.weightTonnes) ?? 0,
        upiId: _upiController.text.trim(),
      );

      _createdOrderId = orderId;

      setState(() => _showSuccess = true);
      await _controller.forward(from: 0);
      await Future<void>.delayed(const Duration(milliseconds: 1100));

      if (!mounted) return;

      TruxifyScope.of(context).openOrders(tabIndex: 0);
      Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (e) {
      debugPrint('Failed to create order: $e');

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to create booking')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Confirm Booking'),
        leading: IconButton(
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.arrow_back_rounded)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        children: [
          InfoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Order summary',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 14),
                _SummaryRow(
                    label: 'Route',
                    value:
                        '${widget.draft.pickup.split(',').first} → ${widget.draft.drop.split(',').first}'),
                _SummaryRow(label: 'Pickup', value: widget.draft.dateLabel),
                _SummaryRow(
                    label: 'Goods',
                    value:
                        '${widget.draft.goodsType}, ${widget.draft.weightTonnes} tonnes'),
                _SummaryRow(
                    label: 'Driver',
                    value:
                        '${widget.truck.driver} ⭐ ${widget.truck.rating.toStringAsFixed(1)}'),
                _SummaryRow(label: 'Truck', value: mockDefaultTruckNumber),
              ],
            ),
          ),
          const SizedBox(height: 16),
          InfoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Price breakdown',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 14),
                ...mockBookingPriceLines.map(
                  (line) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Row(
                      children: [
                        Text(line.label,
                            style: Theme.of(context)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(
                                    fontWeight: line.isTotal
                                        ? FontWeight.w800
                                        : FontWeight.w500)),
                        const Spacer(),
                        Text(line.amount,
                            style: Theme.of(context)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(
                                    fontWeight: line.isTotal
                                        ? FontWeight.w800
                                        : FontWeight.w600)),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                const Divider(),
                const SizedBox(height: 8),
                Row(
                  children: [
                    const Icon(Icons.lock_rounded,
                        color: TruxifyColors.accentDark, size: 18),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Payment secured via UPI Escrow 🔒',
                        style: Theme.of(context)
                            .textTheme
                            .bodyMedium
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text('Released only on delivery',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: TruxifyColors.adaptiveSecondaryText(context))),
              ],
            ),
          ),
          const SizedBox(height: 16),
          InfoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Pay via UPI',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                TextField(
                    controller: _upiController,
                    decoration:
                        const InputDecoration(labelText: 'Mock UPI ID')),
                const SizedBox(height: 16),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 250),
                  child: _showSuccess
                      ? _SuccessPanel(
                          controller: _controller,
                          orderId: _createdOrderId ?? '',
                        )
                      : PrimaryButton(label: 'Pay & Confirm', onPressed: _pay),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

const mockDefaultTruckNumber = 'TN 45 AB 1234';

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 88,
            child: Text(label,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: TruxifyColors.adaptiveSecondaryText(context))),
          ),
          Expanded(
              child: Text(value,
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium
                      ?.copyWith(fontWeight: FontWeight.w700))),
        ],
      ),
    );
  }
}

class _SuccessPanel extends StatelessWidget {
  const _SuccessPanel({
    required this.controller,
    required this.orderId,
  });

  final AnimationController controller;
  final String orderId;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, child) {
        final scale = Curves.easeOutBack.transform(controller.value);
        return Transform.scale(
          scale: scale,
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
            decoration: BoxDecoration(
              color: Theme.of(context).brightness == Brightness.dark
                  ? TruxifyColors.darkAccentLight
                  : TruxifyColors.accentLight,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                  color: TruxifyColors.accent.withValues(alpha: 0.2)),
            ),
            child: Column(
              children: [
                Icon(
                  Icons.check_circle_rounded,
                  color: Theme.of(context).brightness == Brightness.dark
                      ? TruxifyColors.accent
                      : TruxifyColors.accentDark,
                  size: 58,
                ),
                const SizedBox(height: 10),
                Text('Booking Confirmed! 🎉',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text('Order ID: $orderId',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: TruxifyColors.adaptiveSecondaryText(context))),
              ],
            ),
          ),
        );
      },
    );
  }
}
