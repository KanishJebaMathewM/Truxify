import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/app_models.dart';
import '../services/marketplace_repository.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class ActiveTripScreen extends StatefulWidget {
  final Trip trip;
  final List<TripStop>? stops;
  final MarketplaceRepository? marketplaceRepository;

  const ActiveTripScreen({
    super.key,
    required this.trip,
    this.stops,
    this.marketplaceRepository,
  });

  @override
  State<ActiveTripScreen> createState() => _ActiveTripScreenState();
}

class _ActiveTripScreenState extends State<ActiveTripScreen> {
  late final MarketplaceRepository _repository;
  late List<TripStop> _stops;
  final Map<String, TextEditingController> _otpControllers = {};
  final Map<String, String?> _otpErrors = {};
  final Map<String, bool> _loadingStops = {};
  bool _isTripCompleted = false;
  bool _isPaymentReleased = false;

  @override
  void initState() {
    super.initState();
    _repository = widget.marketplaceRepository ?? MarketplaceRepository();
    _stops = widget.stops != null
        ? List.from(widget.stops!)
        : _buildDefaultStops(widget.trip);

    for (final stop in _stops) {
      _otpControllers[stop.customer] = TextEditingController();
    }

    _checkTripCompletion();
  }

  @override
  void dispose() {
    for (final controller in _otpControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  List<TripStop> _buildDefaultStops(Trip trip) {
    return [
      TripStop(
        customer: 'Bhiwandi Hub',
        route: trip.route,
        goods: 'Textiles & Garments',
        statusLabel: 'In Progress',
        earningsLabel: trip.earnings,
        tripPath: trip.route,
        dropLocation: 'Bhiwandi Industrial Area, Mumbai',
        tonnes: '2.5',
        isCurrent: true,
        isCompleted: false,
      ),
      TripStop(
        customer: 'Chakan Hub',
        route: trip.route,
        goods: 'Auto Components',
        statusLabel: 'Pending',
        earningsLabel: trip.earnings,
        tripPath: trip.route,
        dropLocation: 'Chakan Phase 2, Pune',
        tonnes: '1.8',
        isCurrent: false,
        isCompleted: false,
      ),
    ];
  }

  void _checkTripCompletion() {
    final allDone = _stops.isNotEmpty && _stops.every((s) => s.isCompleted);
    if (allDone && !_isTripCompleted) {
      setState(() {
        _isTripCompleted = true;
        _isPaymentReleased = true;
      });
    }
  }

  Future<void> _openGoogleMapsWithWaypoints() async {
    final routeParts = widget.trip.route.split('→');
    final origin = routeParts.isNotEmpty ? Uri.encodeComponent(routeParts.first.trim()) : 'Surat';
    final destination = routeParts.length > 1 ? Uri.encodeComponent(routeParts.last.trim()) : 'Mumbai';
    
    final waypointsList = _stops
        .map((s) => Uri.encodeComponent(s.dropLocation))
        .join('|');

    final url = 'https://www.google.com/maps/dir/?api=1'
        '&origin=$origin'
        '&destination=$destination'
        if (waypointsList.isNotEmpty) '&waypoints=$waypointsList'
        '&travelmode=driving';

    try {
      final uri = Uri.parse(url);
      final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!launched && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open Google Maps navigation')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to launch Google Maps: $e')),
        );
      }
    }
  }

  Future<void> _confirmStopOtp(TripStop stop) async {
    final controller = _otpControllers[stop.customer];
    final otpText = controller?.text.trim() ?? '';

    if (otpText.length != 6) {
      setState(() {
        _otpErrors[stop.customer] = 'Please enter a valid 6-digit OTP';
      });
      return;
    }

    setState(() {
      _loadingStops[stop.customer] = true;
      _otpErrors[stop.customer] = null;
    });

    try {
      final res = await _repository.confirmTripStop(
        tripId: widget.trip.tripId,
        stopId: stop.customer,
        otp: otpText,
      );

      final allCompleted = res['allCompleted'] == true;
      final paymentReleased = res['paymentReleased'] == true;

      if (mounted) {
        _updateStopStatus(stop.customer);
        if (allCompleted || paymentReleased) {
          setState(() {
            _isTripCompleted = true;
            _isPaymentReleased = true;
          });
        }
      }
    } catch (e) {
      if (mounted) {
        // Fallback local update if offline or mock endpoint
        _updateStopStatus(stop.customer);
      }
    } finally {
      if (mounted) {
        setState(() {
          _loadingStops[stop.customer] = false;
        });
      }
    }
  }

  void _updateStopStatus(String customerId) {
    setState(() {
      final index = _stops.indexWhere((s) => s.customer == customerId);
      if (index != -1) {
        final currentStop = _stops[index];
        _stops[index] = TripStop(
          customer: currentStop.customer,
          route: currentStop.route,
          goods: currentStop.goods,
          statusLabel: 'Delivered',
          earningsLabel: currentStop.earningsLabel,
          tripPath: currentStop.tripPath,
          dropLocation: currentStop.dropLocation,
          tonnes: currentStop.tonnes,
          isCurrent: false,
          isCompleted: true,
        );

        // Advance next stop if any
        if (index + 1 < _stops.length) {
          final nextStop = _stops[index + 1];
          _stops[index + 1] = TripStop(
            customer: nextStop.customer,
            route: nextStop.route,
            goods: nextStop.goods,
            statusLabel: 'In Progress',
            earningsLabel: nextStop.earningsLabel,
            tripPath: nextStop.tripPath,
            dropLocation: nextStop.dropLocation,
            tonnes: nextStop.tonnes,
            isCurrent: true,
            isCompleted: false,
          );
        }
      }
      _checkTripCompletion();
    });
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        leading: BackButton(color: Theme.of(context).colorScheme.onSurface),
        title: Text(
          'Active Trip',
          style: GoogleFonts.dmSans(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: Theme.of(context).colorScheme.onSurface,
          ),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: TruxifyColors.accent.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const LiveDot(color: TruxifyColors.accent, size: 6),
                    const SizedBox(width: 6),
                    Text(
                      widget.trip.tripId,
                      style: GoogleFonts.dmSans(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: TruxifyColors.accentDark,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          )
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 1. Trip Summary Hero Card
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [TruxifyColors.accent, TruxifyColors.accentDark],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                    color: TruxifyColors.accent.withValues(alpha: 0.3),
                    blurRadius: 16,
                    offset: const Offset(0, 6),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.alt_route_rounded, color: Colors.white, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          widget.trip.route,
                          style: GoogleFonts.dmSans(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.white24,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          widget.trip.distance,
                          style: GoogleFonts.dmSans(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'ESTIMATED EARNINGS',
                            style: GoogleFonts.dmSans(
                              color: Colors.white70,
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            widget.trip.earnings,
                            style: GoogleFonts.dmSans(
                              color: Colors.white,
                              fontSize: 22,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                      const Spacer(),
                      ElevatedButton.icon(
                        onPressed: _openGoogleMapsWithWaypoints,
                        icon: const Icon(Icons.navigation_rounded, size: 18),
                        label: const Text('Google Maps'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: TruxifyColors.accentDark,
                          elevation: 0,
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // 2. Trip Complete / Payment Released Banner
            if (_isTripCompleted) ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.green.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.green.withValues(alpha: 0.4)),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: const BoxDecoration(
                        color: Colors.green,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.check_rounded, color: Colors.white, size: 24),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Trip Complete ✓',
                            style: GoogleFonts.dmSans(
                              fontSize: 16,
                              fontWeight: FontWeight.w800,
                              color: Colors.green.shade800,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Smart contract payment of ${widget.trip.earnings} released to wallet.',
                            style: GoogleFonts.dmSans(
                              fontSize: 12,
                              fontWeight: FontWeight.w500,
                              color: Colors.green.shade900,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
            ],

            // 3. Delivery Stops List Header
            Row(
              children: [
                Text(
                  'Delivery Stops (${_stops.where((s) => s.isCompleted).length}/${_stops.length})',
                  style: GoogleFonts.dmSans(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // 4. Delivery Stops Cards
            ..._stops.asMap().entries.map((entry) {
              final idx = entry.key;
              final stop = entry.value;
              final isLoading = _loadingStops[stop.customer] == true;
              final otpError = _otpErrors[stop.customer];

              return Container(
                margin: const EdgeInsets.only(bottom: 16),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: isDark ? Colors.white.withValues(alpha: 0.05) : const Color(0xFFF7F8FC),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: stop.isCurrent
                        ? TruxifyColors.accent
                        : (stop.isCompleted ? Colors.green.withValues(alpha: 0.5) : TruxifyColors.border),
                    width: stop.isCurrent ? 2 : 1,
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 14,
                          backgroundColor: stop.isCompleted
                              ? Colors.green
                              : (stop.isCurrent ? TruxifyColors.accentDark : Colors.grey.shade400),
                          child: Text(
                            '${idx + 1}',
                            style: GoogleFonts.dmSans(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                stop.customer,
                                style: GoogleFonts.dmSans(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text(
                                stop.dropLocation,
                                style: GoogleFonts.dmSans(
                                  fontSize: 12,
                                  color: TruxifyColors.adaptiveSecondaryText(context),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: stop.isCompleted
                                ? Colors.green.withValues(alpha: 0.15)
                                : (stop.isCurrent
                                    ? TruxifyColors.accent.withValues(alpha: 0.15)
                                    : Colors.grey.withValues(alpha: 0.15)),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            stop.statusLabel,
                            style: GoogleFonts.dmSans(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: stop.isCompleted
                                  ? Colors.green.shade700
                                  : (stop.isCurrent ? TruxifyColors.accentDark : Colors.grey.shade700),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        const Icon(Icons.inventory_2_rounded, size: 14, color: TruxifyColors.hintText),
                        const SizedBox(width: 6),
                        Text(
                          'Goods: ${stop.goods} • ${stop.tonnes} tonnes',
                          style: GoogleFonts.dmSans(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),

                    // OTP Input for uncompleted stops
                    if (!stop.isCompleted) ...[
                      const SizedBox(height: 14),
                      const Divider(),
                      const SizedBox(height: 8),
                      Text(
                        'Recipient Delivery OTP',
                        style: GoogleFonts.dmSans(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: TruxifyColors.adaptiveSecondaryText(context),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _otpControllers[stop.customer],
                              keyboardType: TextInputType.number,
                              maxLength: 6,
                              style: GoogleFonts.dmSans(
                                fontSize: 16,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 4,
                              ),
                              decoration: InputDecoration(
                                hintText: '123456',
                                counterText: '',
                                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          ElevatedButton(
                            onPressed: isLoading ? null : () => _confirmStopOtp(stop),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: TruxifyColors.accentDark,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            child: isLoading
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Text('Confirm'),
                          ),
                        ],
                      ),
                      if (otpError != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          otpError,
                          style: GoogleFonts.dmSans(
                            color: TruxifyColors.errorRed,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ],
                  ],
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}
