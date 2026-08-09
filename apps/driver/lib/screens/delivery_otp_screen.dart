import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:geolocator/geolocator.dart';
import '../services/api_client.dart';
import '../theme/app_theme.dart';

/// DeliveryOtpScreen — shown to the driver when order status is 'arriving'.
///
/// Features:
///   • 6-digit PIN input with auto-focus
///   • "Confirm Delivery" → POST /api/orders/:id/confirm-otp
///   • GPS Geofence auto-detect: checks distance every 5s
///     - Within 500m → shows "Auto-confirm available" badge
///     - Tapping badge → POST /api/orders/:id/geofence-confirm
///   • Animated "Payment Released ✓ ₹XXXX credited" success banner
///   • "Payout Pending Reconciliation" banner when escrow update failed
///   • Haptic feedback on success
class DeliveryOtpScreen extends StatefulWidget {
  const DeliveryOtpScreen({
    super.key,
    required this.orderId,
    required this.orderDisplayId,
    required this.dropLat,
    required this.dropLng,
    required this.amountInr,
  });

  final String orderId;
  final String orderDisplayId;
  final double? dropLat;
  final double? dropLng;
  final String? amountInr;

  @override
  State<DeliveryOtpScreen> createState() => _DeliveryOtpScreenState();
}

class _DeliveryOtpScreenState extends State<DeliveryOtpScreen>
    with TickerProviderStateMixin {
  final _apiClient = ApiClient();

  // OTP input state
  final List<TextEditingController> _digitControllers =
      List.generate(6, (_) => TextEditingController());
  final List<FocusNode> _focusNodes = List.generate(6, (_) => FocusNode());
  String get _otp => _digitControllers.map((c) => c.text).join();

  // UI state
  bool _isVerifying = false;
  bool _isGeofenceConfirming = false;
  bool _paymentReleased = false;
  bool _reconciliationRequired = false;
  String? _errorMessage;
  String? _releasedAmount;

  // Geofence
  double? _distanceM;
  bool _withinGeofence = false;
  bool _geofenceVerified = false;
  Timer? _geofenceTimer;
  late final AnimationController _pulseController;

  // Success animation
  late final AnimationController _successController;
  late final Animation<double> _successScale;
  late final Animation<double> _successOpacity;

  static const _geofenceRadius = 500.0; // metres

  @override
  void initState() {
    super.initState();

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 1),
    )..repeat(reverse: true);

    _successController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    );
    _successScale = CurvedAnimation(
        parent: _successController, curve: Curves.easeOutBack);
    _successOpacity =
        CurvedAnimation(parent: _successController, curve: Curves.easeIn);

    if (widget.dropLat != null && widget.dropLng != null) {
      _startGeofenceWatch();
    }
  }

  @override
  void dispose() {
    for (final c in _digitControllers) {
      c.dispose();
    }
    for (final f in _focusNodes) {
      f.dispose();
    }
    _geofenceTimer?.cancel();
    _pulseController.dispose();
    _successController.dispose();
    super.dispose();
  }

  // ── GPS Geofence Watcher ──────────────────────────────────────────────────

  void _startGeofenceWatch() {
    _checkGeofence();
    _geofenceTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted && !_paymentReleased) _checkGeofence();
    });
  }

  Future<void> _checkGeofence() async {
    if (widget.dropLat == null || widget.dropLng == null) return;
    try {
      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) return;

      final pos = await Geolocator.getCurrentPosition(
        locationSettings:
            const LocationSettings(accuracy: LocationAccuracy.high),
      );
      final d = Geolocator.distanceBetween(
        pos.latitude,
        pos.longitude,
        widget.dropLat!,
        widget.dropLng!,
      );

      if (mounted) {
        setState(() {
          _distanceM = d;
          _withinGeofence = d <= _geofenceRadius;
        });
      }
    } catch (_) {
      // GPS unavailable — silent fail
    }
  }

  // ── OTP Input Helpers ─────────────────────────────────────────────────────

  void _onDigitChanged(int index, String value) {
    if (value.length == 1 && index < 5) {
      _focusNodes[index + 1].requestFocus();
    } else if (value.isEmpty && index > 0) {
      _focusNodes[index - 1].requestFocus();
    }
    setState(() => _errorMessage = null);
  }

  void _clearOtp() {
    for (final c in _digitControllers) {
      c.clear();
    }
    _focusNodes.first.requestFocus();
    setState(() => _errorMessage = null);
  }

  // ── OTP Confirm ───────────────────────────────────────────────────────────

  Future<void> _confirmOtp() async {
    if (_otp.length < 6) {
      setState(() => _errorMessage = 'Please enter the full 6-digit OTP.');
      return;
    }
    setState(() {
      _isVerifying = true;
      _errorMessage = null;
    });

    try {
      final body = await _apiClient.post(
        '/api/orders/${widget.orderId}/confirm-otp',
        body: {'otp': _otp},
      );

      final amount = body is Map ? (body['amount_inr'] as String?) : null;
      final reconciliationRequired =
          body is Map && body['reconciliation_required'] == true;
      if (reconciliationRequired) {
        await _showReconciliationPending(amount ?? widget.amountInr);
      } else {
        await _showPaymentReleased(amount ?? widget.amountInr);
      }
    } catch (e) {
      final msg = e.toString().replaceAll('Exception: ', '');
      if (mounted) setState(() => _errorMessage = msg);
    } finally {
      if (mounted) setState(() => _isVerifying = false);
    }
  }

  // ── Geofence Auto-Confirm ─────────────────────────────────────────────────

  Future<void> _geofenceConfirm() async {
    if (widget.dropLat == null || widget.dropLng == null) return;
    setState(() => _isGeofenceConfirming = true);

    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings:
            const LocationSettings(accuracy: LocationAccuracy.high),
      );

      // Client path stays under /api/orders; server route alignment is separate.
      final body = await _apiClient.post(
        '/api/orders/${widget.orderId}/geofence-confirm',
        body: {
          'driver_lat': pos.latitude,
          'driver_lng': pos.longitude,
        },
      );

      if (!mounted) return;

      if (body is Map && body['autoConfirmed'] == true) {
        // Geofence only verifies presence — OTP is still required to release payment.
        final serverMsg = body['message'] as String?;
        setState(() {
          _geofenceVerified = true;
          _errorMessage = null;
        });
        final msg = (serverMsg != null && serverMsg.isNotEmpty)
            ? serverMsg
            : 'Location verified. Enter the customer OTP to release payment.';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      } else {
        final dist = body is Map ? body['distanceM'] as int? : null;
        setState(() => _errorMessage =
            'You are ${dist != null ? '${dist}m' : 'too far'} from the drop point. '
            'Geofence radius is ${_geofenceRadius.toInt()}m.');
      }
    } catch (e) {
      if (!mounted) return;
      setState(
          () => _errorMessage = e.toString().replaceAll('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _isGeofenceConfirming = false);
    }
  }

  Future<void> _showPaymentReleased(String? amount) async {
    HapticFeedback.heavyImpact();
    _geofenceTimer?.cancel();
    setState(() {
      _paymentReleased = true;
      _releasedAmount = amount;
    });
    await _successController.forward();
    await Future<void>.delayed(const Duration(seconds: 3));
    if (mounted) Navigator.of(context).pop(true);
  }

  Future<void> _showReconciliationPending(String? amount) async {
    HapticFeedback.heavyImpact();
    _geofenceTimer?.cancel();
    setState(() {
      _reconciliationRequired = true;
      _releasedAmount = amount;
    });
    await _successController.forward();
    await Future<void>.delayed(const Duration(seconds: 3));
    if (mounted) Navigator.of(context).pop(true);
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? const Color(0xFF0F1117) : const Color(0xFFF5F7FA);

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        backgroundColor: bg,
        elevation: 0,
        title: Text(
          'Confirm Delivery',
          style: GoogleFonts.dmSans(fontWeight: FontWeight.w700),
        ),
        leading: IconButton(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(Icons.arrow_back_rounded),
        ),
      ),
      body: _paymentReleased
          ? _buildSuccessBanner(isDark)
          : _reconciliationRequired
              ? _buildReconciliationBanner(isDark)
              : _buildOtpForm(isDark),
    );
  }

  // ── Success Banner ────────────────────────────────────────────────────────

  Widget _buildSuccessBanner(bool isDark) {
    return Center(
      child: FadeTransition(
        opacity: _successOpacity,
        child: ScaleTransition(
          scale: _successScale,
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 100,
                  height: 100,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      colors: [
                        Colors.green.shade400,
                        Colors.green.shade700,
                      ],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.green.withValues(alpha: 0.4),
                        blurRadius: 24,
                        spreadRadius: 4,
                      ),
                    ],
                  ),
                  child: const Icon(
                    Icons.check_rounded,
                    color: Colors.white,
                    size: 52,
                  ),
                ),
                const SizedBox(height: 28),
                Text(
                  'Payment Released ✓',
                  style: GoogleFonts.dmSans(
                    fontSize: 26,
                    fontWeight: FontWeight.w800,
                    color: isDark ? Colors.white : const Color(0xFF0F1117),
                  ),
                  textAlign: TextAlign.center,
                ),
                if (_releasedAmount != null) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 20, vertical: 10),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          Colors.green.shade600,
                          Colors.green.shade800,
                        ],
                      ),
                      borderRadius: BorderRadius.circular(30),
                    ),
                    child: Text(
                      '₹$_releasedAmount credited',
                      style: GoogleFonts.dmSans(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                Text(
                  'The payment has been released from escrow\nand credited to your wallet.',
                  style: GoogleFonts.dmSans(
                    fontSize: 14,
                    color: isDark ? Colors.white60 : Colors.black54,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  'Order: ${widget.orderDisplayId}',
                  style: GoogleFonts.dmSans(
                    fontSize: 12,
                    color: isDark ? Colors.white38 : Colors.black38,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ── Reconciliation Pending Banner ─────────────────────────────────────────

  Widget _buildReconciliationBanner(bool isDark) {
    return Center(
      child: FadeTransition(
        opacity: _successOpacity,
        child: ScaleTransition(
          scale: _successScale,
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 100,
                  height: 100,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      colors: [
                        Colors.orange.shade400,
                        Colors.orange.shade700,
                      ],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.orange.withValues(alpha: 0.4),
                        blurRadius: 24,
                        spreadRadius: 4,
                      ),
                    ],
                  ),
                  child: const Icon(
                    Icons.hourglass_top_rounded,
                    color: Colors.white,
                    size: 52,
                  ),
                ),
                const SizedBox(height: 28),
                Text(
                  'Payout Pending Reconciliation',
                  style: GoogleFonts.dmSans(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: isDark ? Colors.white : const Color(0xFF0F1117),
                  ),
                  textAlign: TextAlign.center,
                ),
                if (_releasedAmount != null) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 20, vertical: 10),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          Colors.orange.shade600,
                          Colors.orange.shade800,
                        ],
                      ),
                      borderRadius: BorderRadius.circular(30),
                    ),
                    child: Text(
                      '₹$_releasedAmount will be credited',
                      style: GoogleFonts.dmSans(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                Text(
                  'Delivery confirmed, but the escrow payout could not be '
                  'credited automatically. Your payment is pending '
                  'reconciliation and will be credited once it is resolved.',
                  style: GoogleFonts.dmSans(
                    fontSize: 14,
                    color: isDark ? Colors.white60 : Colors.black54,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  'Order: ${widget.orderDisplayId}',
                  style: GoogleFonts.dmSans(
                    fontSize: 12,
                    color: isDark ? Colors.white38 : Colors.black38,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ── OTP Form ──────────────────────────────────────────────────────────────

  Widget _buildOtpForm(bool isDark) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 40),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header card
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  TruxifyColors.accentDark.withValues(alpha: 0.12),
                  TruxifyColors.accent.withValues(alpha: 0.06),
                ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                  color: TruxifyColors.accent.withValues(alpha: 0.2)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.delivery_dining_rounded,
                        color: TruxifyColors.accentDark, size: 22),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        widget.orderDisplayId,
                        style: GoogleFonts.dmSans(
                          fontWeight: FontWeight.w800,
                          fontSize: 15,
                          color: TruxifyColors.accentDark,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  'Ask the customer to share the 6-digit OTP '
                  'from their Truxify app to confirm delivery.',
                  style: GoogleFonts.dmSans(
                    fontSize: 13,
                    color: isDark ? Colors.white70 : Colors.black54,
                  ),
                ),
                if (widget.amountInr != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: Colors.green.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.currency_rupee_rounded,
                            size: 14, color: Colors.green),
                        const SizedBox(width: 4),
                        Text(
                          '${widget.amountInr} will be released',
                          style: GoogleFonts.dmSans(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: Colors.green,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),

          // Geofence badge
          if (widget.dropLat != null) ...[
            const SizedBox(height: 16),
            _GeofenceBadge(
              distanceM: _distanceM,
              withinGeofence: _withinGeofence,
              geofenceVerified: _geofenceVerified,
              isConfirming: _isGeofenceConfirming,
              pulseController: _pulseController,
              onAutoConfirm: _geofenceConfirm,
            ),
          ],

          const SizedBox(height: 28),

          // OTP label
          Text(
            'Enter Delivery OTP',
            style: GoogleFonts.dmSans(
              fontSize: 17,
              fontWeight: FontWeight.w800,
              color: isDark ? Colors.white : const Color(0xFF0F1117),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Provided by the customer on delivery',
            style: GoogleFonts.dmSans(
              fontSize: 12,
              color: isDark ? Colors.white54 : Colors.black45,
            ),
          ),
          const SizedBox(height: 18),

          // 6-digit PIN boxes
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: List.generate(6, (i) {
              return _OtpDigitBox(
                controller: _digitControllers[i],
                focusNode: _focusNodes[i],
                onChanged: (v) => _onDigitChanged(i, v),
                isDark: isDark,
              );
            }),
          ),

          // Error message
          if (_errorMessage != null) ...[
            const SizedBox(height: 14),
            Container(
              width: double.infinity,
              padding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.red.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Colors.red.withValues(alpha: 0.3)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.error_outline_rounded,
                      color: Colors.red, size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _errorMessage!,
                      style: GoogleFonts.dmSans(
                          fontSize: 13, color: Colors.red.shade700),
                    ),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 28),

          // Confirm button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              id: 'btn_confirm_delivery_otp',
              onPressed: (_isVerifying || _otp.length < 6)
                  ? null
                  : _confirmOtp,
              style: ElevatedButton.styleFrom(
                backgroundColor: TruxifyColors.accentDark,
                foregroundColor: Colors.white,
                disabledBackgroundColor:
                    TruxifyColors.accentDark.withValues(alpha: 0.4),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14)),
                elevation: 3,
              ),
              child: _isVerifying
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : Text(
                      'Confirm Delivery',
                      style: GoogleFonts.dmSans(
                          fontSize: 16, fontWeight: FontWeight.w700),
                    ),
            ),
          ),
          const SizedBox(height: 12),

          // Clear button
          Center(
            child: TextButton.icon(
              id: 'btn_clear_otp',
              onPressed: _clearOtp,
              icon: const Icon(Icons.backspace_outlined, size: 16),
              label: Text(
                'Clear OTP',
                style: GoogleFonts.dmSans(fontSize: 13),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Geofence Badge ────────────────────────────────────────────────────────────

class _GeofenceBadge extends StatelessWidget {
  const _GeofenceBadge({
    required this.distanceM,
    required this.withinGeofence,
    this.geofenceVerified = false,
    required this.isConfirming,
    required this.pulseController,
    required this.onAutoConfirm,
  });

  final double? distanceM;
  final bool withinGeofence;
  final bool geofenceVerified;
  final bool isConfirming;
  final AnimationController pulseController;
  final VoidCallback onAutoConfirm;

  @override
  Widget build(BuildContext context) {
    if (distanceM == null) {
      return const SizedBox.shrink();
    }

    final label = geofenceVerified
        ? 'Location verified — enter customer OTP to release payment'
        : withinGeofence
            ? 'You are ${distanceM!.toInt()}m away — Auto-confirm available'
            : 'You are ${distanceM!.toInt()}m away (need <500m for auto-confirm)';

    return Semantics(
      button: true,
      enabled: withinGeofence && !isConfirming && !geofenceVerified,
      label: label,
      child: GestureDetector(
        onTap: withinGeofence && !isConfirming && !geofenceVerified ? onAutoConfirm : null,
        child: AnimatedBuilder(
        animation: pulseController,
        builder: (context, child) {
          final opacity =
              withinGeofence ? 0.7 + 0.3 * pulseController.value : 1.0;
          return Opacity(
            opacity: opacity,
            child: child,
          );
        },
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: withinGeofence
                ? Colors.green.withValues(alpha: 0.12)
                : Colors.orange.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: withinGeofence
                  ? Colors.green.withValues(alpha: 0.4)
                  : Colors.orange.withValues(alpha: 0.3),
            ),
          ),
          child: Row(
            children: [
              Icon(
                withinGeofence
                    ? Icons.location_on_rounded
                    : Icons.location_off_rounded,
                color: withinGeofence ? Colors.green : Colors.orange,
                size: 18,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  label,
                  style: GoogleFonts.dmSans(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: withinGeofence
                        ? Colors.green.shade700
                        : Colors.orange.shade700,
                  ),
                ),
              ),
              if (withinGeofence)
                isConfirming
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.green,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          'Auto-Confirm',
                          style: GoogleFonts.dmSans(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: Colors.white),
                        ),
                      ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── OTP Digit Box ─────────────────────────────────────────────────────────────

class _OtpDigitBox extends StatelessWidget {
  const _OtpDigitBox({
    required this.controller,
    required this.focusNode,
    required this.onChanged,
    required this.isDark,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 46,
      height: 56,
      child: TextField(
        controller: controller,
        focusNode: focusNode,
        keyboardType: TextInputType.number,
        textAlign: TextAlign.center,
        maxLength: 1,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        onChanged: onChanged,
        style: GoogleFonts.dmSans(
          fontSize: 22,
          fontWeight: FontWeight.w800,
          color: isDark ? Colors.white : const Color(0xFF0F1117),
        ),
        decoration: InputDecoration(
          counterText: '',
          filled: true,
          fillColor: isDark
              ? const Color(0xFF1A1D26)
              : Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(
                color: TruxifyColors.accent.withValues(alpha: 0.3)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(
                color: TruxifyColors.accentDark, width: 2),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(
                color: isDark
                    ? Colors.white12
                    : Colors.black.withValues(alpha: 0.1)),
          ),
        ),
      ),
    );
  }
}
