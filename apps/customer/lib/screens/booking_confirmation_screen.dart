import 'package:flutter/material.dart';
import '../services/order_service.dart';
import '../controllers/app_controller.dart';
import '../models/app_models.dart';
import '../models/payment_method.dart';
import '../models/saved_address.dart';
import '../repositories/address_repository.dart';
import '../repositories/payment_repository.dart';
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
  final _paymentRepo = PaymentRepository();
  final _addressRepo = AddressRepository();
  bool _showSuccess = false;
  bool _isLoading = true;
  bool _isSubmitting = false;
  String? _createdOrderId;
  late final AnimationController _controller;
  late final OrderService _orderService;
  List<PaymentMethod> _paymentMethods = [];
  List<SavedAddress> _addresses = [];
  PaymentMethod? _selectedPayment;
  SavedAddress? _selectedAddress;

  @override
  void initState() {
    super.initState();
    _orderService = OrderService();
    _controller = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 600));
    _loadCheckoutData();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _loadCheckoutData() async {
    setState(() => _isLoading = true);
    try {
      final methods = await _paymentRepo.fetchAll();
      final addresses = await _addressRepo.fetchAll();

      if (!mounted) return;

      setState(() {
        _paymentMethods = methods;
        _addresses = addresses;
        _selectedPayment = methods.isEmpty
            ? null
            : methods.firstWhere(
                (m) => m.isDefault,
                orElse: () => methods.first,
              );
        _selectedAddress = addresses.isEmpty
            ? null
            : addresses.firstWhere(
                (a) => a.isDefault,
                orElse: () => addresses.first,
              );
      });
    } catch (e) {
      debugPrint('Failed to load checkout data: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to load checkout options: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _pay() async {
    final finalDropLat = _selectedAddress?.latitude ?? widget.draft.dropLat;
    final finalDropLng = _selectedAddress?.longitude ?? widget.draft.dropLng;

    if (_isSubmitting) return;

    if (widget.draft.pickupLat == null ||
        widget.draft.pickupLng == null ||
        finalDropLat == null ||
        finalDropLng == null) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Missing pickup or drop coordinates. Please go back and select valid locations.')),
      );
      return;
    }

    final weight = double.tryParse(widget.draft.weightTonnes);
    if (weight == null || weight <= 0) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Invalid weight. Please enter a valid weight.')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      final pickupDate = widget.draft.pickupDate;
      final pickupTime = pickupDate != null
          ? '${pickupDate.hour.toString().padLeft(2, '0')}:'
              '${pickupDate.minute.toString().padLeft(2, '0')}'
          : widget.draft.dateLabel;

      final orderId = await _orderService.createOrder(
        pickupAddress: widget.draft.pickup,
        dropAddress: _selectedAddress?.fullAddress ?? widget.draft.drop,
        pickupLat: widget.draft.pickupLat!,
        pickupLng: widget.draft.pickupLng!,
        dropLat: finalDropLat,
        dropLng: finalDropLng,
        pickupTime: pickupTime,
        pickupDate: pickupDate,
        goodsType: widget.draft.goodsType,
        weightTonnes: weight,
        paymentMethodId: _selectedPayment?.id,
        requiresRefrigeration: widget.draft.requiresRefrigeration,
        targetTemperatureMin: widget.draft.targetTemperatureMin,
        targetTemperatureMax: widget.draft.targetTemperatureMax,
      );

      _createdOrderId = orderId;

      if (!mounted) return;
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
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
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
                        '${widget.draft.pickup.split(',').first} → ${_selectedAddress != null ? _selectedAddress!.label : widget.draft.drop.split(',').first}'),
                _SummaryRow(label: 'Pickup', value: widget.draft.dateLabel),
                _SummaryRow(
                    label: 'Goods',
                    value:
                        '${widget.draft.goodsType}, ${widget.draft.weightTonnes} tonnes'),
                _SummaryRow(
                    label: 'Driver',
                    value:
                        '${widget.truck.driver} ⭐ ${widget.truck.rating.toStringAsFixed(1)}'),
                _SummaryRow(label: 'Truck', value: widget.truck.truckNumber ?? widget.truck.truck),
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
                if (widget.truck.baseFreight != null) ...[
                  _PriceLineRow(label: 'Base freight', amount: widget.truck.baseFreight!),
                  if (widget.truck.tollEstimate != null)
                    _PriceLineRow(label: 'Toll estimate', amount: widget.truck.tollEstimate!),
                  if (widget.truck.platformFee != null)
                    _PriceLineRow(label: 'Platform fee', amount: widget.truck.platformFee!),
                  _PriceLineRow(label: 'Total', amount: widget.truck.price, isTotal: true),
                ] else
                  _PriceLineRow(label: 'Total', amount: widget.truck.price, isTotal: true),
                if (widget.truck.isAiEstimate) ...[
                  const SizedBox(height: 4),
                  const Divider(),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const Icon(Icons.auto_awesome_rounded,
                          color: TruxifyColors.accentDark, size: 18),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'AI Estimated Price',
                          style: Theme.of(context)
                              .textTheme
                              .bodyMedium
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                      ),
                    ],
                  ),
                ],
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
                DropdownButtonFormField<PaymentMethod>(
                  value: _selectedPayment,
                  decoration: InputDecoration(
                    labelText: 'Select payment method',
                    helperText: _isLoading
                        ? 'Loading payment methods...'
                        : (_paymentMethods.isEmpty
                            ? 'No payment methods saved. Please add one in Profile.'
                            : null),
                  ),
                  items: _paymentMethods
                      .map(
                        (method) => DropdownMenuItem<PaymentMethod>(
                          value: method,
                          child: Text(method.displayLabel),
                        ),
                      )
                      .toList(),
                  onChanged: _isLoading || _paymentMethods.isEmpty
                      ? null
                      : (value) {
                          setState(() {
                            _selectedPayment = value;
                          });
                        },
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<SavedAddress>(
                  value: _selectedAddress,
                  decoration: InputDecoration(
                    labelText: 'Select saved address',
                    helperText: _isLoading
                        ? 'Loading saved addresses...'
                        : (_addresses.isEmpty
                            ? 'No saved addresses. Please add one in Profile.'
                            : null),
                  ),
                  items: _addresses
                      .map(
                        (address) => DropdownMenuItem<SavedAddress>(
                          value: address,
                          child: Text(address.label),
                        ),
                      )
                      .toList(),
                  onChanged: _isLoading || _addresses.isEmpty
                      ? null
                      : (value) {
                          setState(() {
                            _selectedAddress = value;
                          });
                        },
                ),
                const SizedBox(height: 16),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 250),
                  child: _showSuccess
                      ? _SuccessPanel(
                          controller: _controller,
                          orderId: _createdOrderId ?? '',
                        )
                      : PrimaryButton(
                          label: _isSubmitting
                              ? 'Submitting...'
                              : (_isLoading ? 'Loading...' : 'Pay & Confirm'),
                          onPressed: _isLoading || _isSubmitting ? null : _pay,
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

class _PriceLineRow extends StatelessWidget {
  const _PriceLineRow({
    required this.label,
    required this.amount,
    this.isTotal = false,
  });

  final String label;
  final String amount;
  final bool isTotal;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Text(label,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(
                      fontWeight: isTotal
                          ? FontWeight.w800
                          : FontWeight.w500)),
          const Spacer(),
          Text(amount,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(
                      fontWeight: isTotal
                          ? FontWeight.w800
                          : FontWeight.w600)),
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
