import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/order_service.dart';
import '../controllers/app_controller.dart';
import '../models/app_models.dart';
import '../models/payment_method.dart';
import '../models/saved_address.dart';
import '../repositories/address_repository.dart';
import '../repositories/payment_repository.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import '../core/api_client.dart';

/// Payment pipeline:
///   1. createOrder()  → orderId returned
///   2. GET /api/payments/:orderId/status  → confirm escrow state
///   3. POST /api/payments/upi-intent      → get UPI deep-link
///   4. url_launcher opens UPI app         → user completes payment
///   5. POST /api/payments/lock { tx_hash } → backend verifies on-chain
///   6. Show "Payment Locked in Escrow 🔒" confirmation
class BookingConfirmationScreen extends StatefulWidget {
  const BookingConfirmationScreen({
    super.key,
    required this.draft,
    required this.truck,
    this.orderService,
    this.paymentRepository,
    this.addressRepository,
    this.apiClient,
  });

  final RouteDraft draft;
  final TruckResultData truck;

  /// Test seam — defaults are constructed in the state when null.
  final OrderService? orderService;
  final PaymentRepository? paymentRepository;
  final AddressRepository? addressRepository;
  final ApiClient? apiClient;

  @override
  State<BookingConfirmationScreen> createState() =>
      _BookingConfirmationScreenState();
}

class _BookingConfirmationScreenState extends State<BookingConfirmationScreen>
    with SingleTickerProviderStateMixin {
  late final PaymentRepository _paymentRepo;
  late final AddressRepository _addressRepo;
  late final ApiClient _apiClient;

  bool _showSuccess = false;
  bool _isLoading = true;
  bool _isSubmitting = false;
  bool _isAwaitingUpi = false;

  String? _createdOrderId;
  String? _createdOrderDisplayId;
  String? _upiDeepLink;
  String? _amountInr;
  String? _upiIntentError;
  String? _lockError;

  late final AnimationController _controller;
  late final OrderService _orderService;
  List<PaymentMethod> _paymentMethods = [];
  List<SavedAddress> _addresses = [];
  PaymentMethod? _selectedPayment;
  SavedAddress? _selectedAddress;
  bool _isPassengerMode = false;

  @override
  void initState() {
    super.initState();
    _orderService = widget.orderService ?? OrderService();
    _paymentRepo = widget.paymentRepository ?? PaymentRepository();
    _addressRepo = widget.addressRepository ?? AddressRepository();
    _apiClient = widget.apiClient ?? ApiClient();
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

  // ── Step 1: Create order ───────────────────────────────────────────────────
  Future<void> _createOrderAndInitiatePayment() async {
    final finalDropLat = _selectedAddress?.latitude ?? widget.draft.dropLat;
    final finalDropLng = _selectedAddress?.longitude ?? widget.draft.dropLng;

    if (_isSubmitting) return;

    if (widget.draft.pickupLat == null ||
        widget.draft.pickupLng == null ||
        finalDropLat == null ||
        finalDropLng == null) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text(
                'Missing pickup or drop coordinates. Please go back and select valid locations.')),
      );
      return;
    }

    final weight = double.tryParse(widget.draft.weightTonnes);
    if (weight == null || weight <= 0) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Invalid weight. Please enter a valid weight.')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      final orderId = await _orderService.createOrder(
        pickupAddress: widget.draft.pickup,
        dropAddress: _selectedAddress?.fullAddress ?? widget.draft.drop,
        pickupLat: widget.draft.pickupLat!,
        pickupLng: widget.draft.pickupLng!,
        dropLat: finalDropLat,
        dropLng: finalDropLng,
        pickupTime: widget.draft.dateLabel,
        goodsType: widget.draft.goodsType + (_isPassengerMode ? ' + Passenger' : ''),
        weightTonnes: double.tryParse(widget.draft.weightTonnes) ?? 0,
        paymentMethodId: _selectedPayment?.id,
        requiresRefrigeration: widget.draft.requiresRefrigeration ?? false,
        targetTemperatureMin: widget.draft.targetTemperatureMin,
        targetTemperatureMax: widget.draft.targetTemperatureMax,
        driverId: widget.truck.driverId,
        truckId: widget.truck.truckId,
      );

      _createdOrderId = orderId;

      // ── Step 2: Fetch UPI intent ──────────────────────────────────────────
      await _fetchUpiIntent(orderId);
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

  // ── Step 2: Get UPI intent ────────────────────────────────────────────────
  Future<void> _fetchUpiIntent(String orderId) async {
    try {
      final body = await _apiClient.post(
        '/api/payments/upi-intent',
        body: {'order_id': orderId},
      );
      if (body is Map<String, dynamic>) {
        setState(() {
          _upiDeepLink = body['deep_link'] as String?;
          _amountInr = body['amount_inr'] as String?;
          _createdOrderDisplayId = body['order_ref'] as String?;
          _isAwaitingUpi = true;
        });
      }
    } catch (e) {
      debugPrint('UPI intent failed: $e');
      if (!mounted) return;
      setState(() {
        _upiIntentError = e.toString().replaceAll('Exception: ', '');
        _isAwaitingUpi = false;
      });
    }
  }

  // ── Step 2 retry: Re-invoke the UPI intent flow after a failure ───────────
  Future<void> _retryUpiIntent() async {
    final orderId = _createdOrderId;
    if (orderId == null || _isSubmitting) return;
    setState(() {
      _upiIntentError = null;
      _isSubmitting = true;
    });
    await _fetchUpiIntent(orderId);
    if (mounted) {
      setState(() => _isSubmitting = false);
    }
  }

  // ── Step 3: Open UPI deep-link ────────────────────────────────────────────
  Future<void> _launchUpi() async {
    if (_upiDeepLink == null) return;
    final uri = Uri.parse(_upiDeepLink!);
    try {
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
        // After returning from UPI app, user taps "I've Paid" button
      } else {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text(
                  'No UPI app found. Please install GPay, PhonePe, or Paytm.')),
        );
      }
    } catch (e) {
      debugPrint('Failed to launch UPI: $e');
    }
  }

  // ── Step 4: Verify payment after UPI success ───────────────────────────────
  // POST /api/payments/lock requires the real on-chain tx_hash that a wallet
  // SDK returns once `createBooking` is mined; recordDepositTx() verifies it
  // against Polygon. No wallet SDK is integrated in this app, so there is no
  // real hash to submit — fabricating one would post a hash the backend can
  // never verify and the escrow would never lock.
  //
  // Instead we poll GET /api/payments/:orderId/status and only show the
  // success panel when the backend reports escrow_status == 'funded'. Any
  // other result renders a retryable pending state with a path back to the
  // bookings list — never a false confirmation, never a dead-end.
  Future<void> _confirmPaymentLocked() async {
    final orderId = _createdOrderId;
    if (orderId == null || _isSubmitting) return;

    setState(() {
      _isSubmitting = true;
      _lockError = null;
    });

    try {
      final body = await _apiClient.get('/api/payments/$orderId/status');
      final escrowStatus =
          body is Map<String, dynamic> ? body['escrow_status']?.toString() : null;

      if (!mounted) return;

      if (escrowStatus == 'funded') {
        _showSuccessPanel();
      } else {
        setState(() {
          _lockError = escrowStatus == null
              ? 'We could not verify your payment right now. Please check again.'
              : 'Your payment is still being verified (status: $escrowStatus). '
                  'Please check again in a moment.';
        });
      }
    } catch (e) {
      debugPrint('Payment verification failed: $e');
      if (!mounted) return;
      setState(() {
        _lockError =
            'We could not verify your payment right now. Please check again.';
      });
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  void _exitToBookings() {
    if (!mounted) return;
    TruxifyScope.of(context).openOrders(tabIndex: 0);
    Navigator.of(context).popUntil((route) => route.isFirst);
  }

  void _showSuccessPanel() {
    if (!mounted) return;
    setState(() {
      _showSuccess = true;
      _isAwaitingUpi = false;
    });
    _controller.forward(from: 0).then((_) async {
      await Future<void>.delayed(const Duration(milliseconds: 1200));
      _exitToBookings();
    });
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
                _SummaryRow(
                    label: 'Truck',
                    value: widget.truck.truckNumber ?? widget.truck.truck),
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
                  _PriceLineRow(
                      label: 'Base freight',
                      amount: widget.truck.baseFreight!),
                  if (widget.truck.tollEstimate != null)
                    _PriceLineRow(
                        label: 'Toll estimate',
                        amount: widget.truck.tollEstimate!),
                  if (widget.truck.platformFee != null)
                    _PriceLineRow(
                        label: 'Platform fee',
                        amount: widget.truck.platformFee!),
                  _PriceLineRow(
                      label: 'Total',
                      amount: widget.truck.price,
                      isTotal: true),
                ] else
                  _PriceLineRow(
                      label: 'Total',
                      amount: widget.truck.price,
                      isTotal: true),
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
                        color:
                            TruxifyColors.adaptiveSecondaryText(context))),
              ],
            ),
          ),
          const SizedBox(height: 16),
          InfoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text('Passenger Mode 🚌',
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.w800)),
                    const Spacer(),
                    Switch(
                      value: _isPassengerMode,
                      onChanged: (val) => setState(() => _isPassengerMode = val),
                      activeColor: TruxifyColors.accent,
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'Book a space in the back of the trailer for cheap cross-country travel. (No seatbelts provided).',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context)),
                ),
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
                          orderId: _createdOrderDisplayId ?? _createdOrderId ?? '',
                          amountInr: _amountInr,
                        )
                      : _lockError != null
                          ? _VerificationPendingSheet(
                              message: _lockError!,
                              isChecking: _isSubmitting,
                              onCheckAgain: _confirmPaymentLocked,
                              onBackToBookings: _exitToBookings,
                            )
                          : _upiIntentError != null
                              ? _UpiIntentErrorSheet(
                                  message: _upiIntentError!,
                                  isRetrying: _isSubmitting,
                                  onRetry: _retryUpiIntent,
                                )
                              : _isAwaitingUpi
                                  ? _UpiPaymentSheet(
                                      amountInr: _amountInr ?? widget.truck.price,
                                      isSubmitting: _isSubmitting,
                                      onLaunchUpi: _launchUpi,
                                      onConfirmPaid: _confirmPaymentLocked,
                                    )
                                  : PrimaryButton(
                                      label: _isSubmitting
                                          ? 'Creating booking...'
                                          : (_isLoading
                                              ? 'Loading...'
                                              : 'Pay & Confirm'),
                                      onPressed: _isLoading || _isSubmitting
                                          ? null
                                          : _createOrderAndInitiatePayment,
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

// ── UPI Payment Sheet ─────────────────────────────────────────────────────────

class _UpiPaymentSheet extends StatelessWidget {
  const _UpiPaymentSheet({
    required this.amountInr,
    required this.isSubmitting,
    required this.onLaunchUpi,
    required this.onConfirmPaid,
  });

  final String amountInr;
  final bool isSubmitting;
  final VoidCallback onLaunchUpi;
  final VoidCallback onConfirmPaid;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            TruxifyColors.accent.withValues(alpha: 0.12),
            TruxifyColors.accentDark.withValues(alpha: 0.06),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
            color: TruxifyColors.accent.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: TruxifyColors.accent.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.lock_outline_rounded,
                    color: TruxifyColors.accentDark, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Booking created!',
                        style: Theme.of(context)
                            .textTheme
                            .titleSmall
                            ?.copyWith(fontWeight: FontWeight.w800)),
                    Text('Now secure your booking via UPI',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: TruxifyColors.adaptiveSecondaryText(
                                context))),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
            decoration: BoxDecoration(
              color: Theme.of(context).brightness == Brightness.dark
                  ? TruxifyColors.darkAccentLight
                  : Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                  color: TruxifyColors.accent.withValues(alpha: 0.2)),
            ),
            child: Column(
              children: [
                Text('Amount to Pay',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color:
                            TruxifyColors.adaptiveSecondaryText(context))),
                const SizedBox(height: 4),
                Text('₹$amountInr',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                        color: TruxifyColors.accentDark)),
                const SizedBox(height: 4),
                Text('Locked in blockchain escrow until delivery',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color:
                            TruxifyColors.adaptiveSecondaryText(context)),
                    textAlign: TextAlign.center),
              ],
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              id: 'btn_open_upi_app',
              onPressed: onLaunchUpi,
              icon: const Icon(Icons.open_in_new_rounded, size: 18),
              label: const Text('Open UPI App to Pay'),
              style: ElevatedButton.styleFrom(
                backgroundColor: TruxifyColors.accentDark,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              id: 'btn_confirm_paid',
              onPressed: isSubmitting ? null : onConfirmPaid,
              icon: isSubmitting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.check_circle_outline_rounded, size: 18),
              label:
                  Text(isSubmitting ? 'Confirming...' : "I've Paid — Lock Escrow"),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
                side: BorderSide(
                    color: TruxifyColors.accent.withValues(alpha: 0.5)),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Center(
            child: Text(
              '🔒 Your payment is locked on Polygon blockchain\nuntil GPS + OTP confirms delivery',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: TruxifyColors.adaptiveSecondaryText(context)),
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Existing widgets (unchanged) ──────────────────────────────────────────────

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
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  fontWeight:
                      isTotal ? FontWeight.w800 : FontWeight.w500)),
          const Spacer(),
          Text(amount,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  fontWeight:
                      isTotal ? FontWeight.w800 : FontWeight.w600)),
        ],
      ),
    );
  }
}

class _SuccessPanel extends StatelessWidget {
  const _SuccessPanel({
    required this.controller,
    required this.orderId,
    this.amountInr,
  });

  final AnimationController controller;
  final String orderId;
  final String? amountInr;

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
                        color:
                            TruxifyColors.adaptiveSecondaryText(context))),
                if (amountInr != null) ...[
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: TruxifyColors.accentDark.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.lock_rounded,
                            size: 14, color: TruxifyColors.accentDark),
                        const SizedBox(width: 6),
                        Text('₹$amountInr locked in escrow',
                            style: Theme.of(context)
                                .textTheme
                                .bodySmall
                                ?.copyWith(
                                    fontWeight: FontWeight.w700,
                                    color: TruxifyColors.accentDark)),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

// ── Payment Verification Pending Sheet ───────────────────────────────────────

class _VerificationPendingSheet extends StatelessWidget {
  const _VerificationPendingSheet({
    required this.message,
    required this.isChecking,
    required this.onCheckAgain,
    required this.onBackToBookings,
  });

  final String message;
  final bool isChecking;
  final VoidCallback onCheckAgain;
  final VoidCallback onBackToBookings;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: TruxifyColors.warning.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
            color: TruxifyColors.warning.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: TruxifyColors.warning.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.hourglass_top_rounded,
                    color: TruxifyColors.warning, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Verifying your payment',
                        style: Theme.of(context)
                            .textTheme
                            .titleSmall
                            ?.copyWith(fontWeight: FontWeight.w800)),
                    Text('Your booking is created.',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: TruxifyColors.adaptiveSecondaryText(
                                context))),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(message,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: TruxifyColors.warning)),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              id: 'btn_check_payment_status',
              onPressed: isChecking ? null : onCheckAgain,
              icon: isChecking
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.refresh_rounded, size: 18),
              label: Text(isChecking ? 'Checking...' : 'Check payment status'),
              style: ElevatedButton.styleFrom(
                backgroundColor: TruxifyColors.accentDark,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              id: 'btn_back_to_bookings',
              onPressed: isChecking ? null : onBackToBookings,
              icon: const Icon(Icons.arrow_back_rounded, size: 18),
              label: const Text('Back to bookings'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
                side: BorderSide(
                    color: TruxifyColors.accent.withValues(alpha: 0.5)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── UPI Intent Error Sheet ────────────────────────────────────────────────────

class _UpiIntentErrorSheet extends StatelessWidget {
  const _UpiIntentErrorSheet({
    required this.message,
    required this.isRetrying,
    required this.onRetry,
  });

  final String message;
  final bool isRetrying;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: TruxifyColors.errorRed.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
            color: TruxifyColors.errorRed.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: TruxifyColors.errorRed.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.error_outline_rounded,
                    color: TruxifyColors.errorRed, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Payment setup failed',
                        style: Theme.of(context)
                            .textTheme
                            .titleSmall
                            ?.copyWith(fontWeight: FontWeight.w800)),
                    Text(
                        'Your booking was created, but the payment could not '
                        'be secured. Please retry.',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: TruxifyColors.adaptiveSecondaryText(
                                context))),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(message,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: TruxifyColors.errorRed)),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              id: 'btn_retry_payment',
              onPressed: isRetrying ? null : onRetry,
              icon: isRetrying
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.refresh_rounded, size: 18),
              label: Text(isRetrying ? 'Retrying...' : 'Retry payment'),
              style: ElevatedButton.styleFrom(
                backgroundColor: TruxifyColors.accentDark,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
