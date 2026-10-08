import 'dart:async';
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

  /// Normalises the `amount_inr` value returned by the confirm-otp endpoint
  /// into a displayable string. The API sends a number (rupees), but older
  /// responses may carry a string. Returns null when the API omits the field.
  static String? _amountInr(dynamic value) {
    if (value == null) return null;
    if (value is num) return value.toStringAsFixed(value % 1 == 0 ? 0 : 2);
    return value.toString();
  }

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
      parent: _successController,
      curve: Curves.easeOutBack,
    );
    _successOpacity = CurvedAnimation(
      parent: _successController,
      curve: Curves.easeIn,
    );

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
          permission == LocationPermission.deniedForever) {
        return;
      }

      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
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
    } catch (e) {
      debugPrint('DeliveryOtpScreen: GPS lookup failed: $e');
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
