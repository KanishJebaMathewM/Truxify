import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' as ll;
import 'package:url_launcher/url_launcher.dart';
import '../services/geocode_service.dart';
import '../services/route_service.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/app_theme.dart';
import '../models/app_models.dart';
import '../widgets/common_widgets.dart';

class TripDetailScreen extends StatefulWidget {
  final Trip trip;

  const TripDetailScreen({super.key, required this.trip});

  @override
  State<TripDetailScreen> createState() => _TripDetailScreenState();
}

class _TripDetailScreenState extends State<TripDetailScreen> {
  final MapController _mapController = MapController();
  late Future<_RouteResult?> _routeFuture;

  @override
  void initState() {
    super.initState();
    _routeFuture = _loadRouteForTrip(widget.trip.route);
  }

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }
  Future<void> _openGoogleMapsRoute() async {
    final routeResult = await _routeFuture;
    final start = routeResult?.start;
    final end = routeResult?.end;

    if (start == null || end == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Route coordinates not available')),
        );
      }
      return;
    }

    final url = 'https://www.google.com/maps/dir/?api=1'
        '&origin=${start.latitude},${start.longitude}'
        '&destination=${end.latitude},${end.longitude}'
        '&travelmode=driving';

    try {
      final uri = Uri.parse(url);
      final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!launched && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Unable to open Google Maps')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to open Google Maps')),
        );
      }
    }
  }
  void _showBlockchainBottomSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Padding(
          padding: EdgeInsets.only(
            left: 16,
            right: 16,
            top: 12,
            bottom: MediaQuery.of(context).viewInsets.bottom + 16,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Center(child: BottomSheetHandle()),
              const SizedBox(height: 16),
              Center(
                child: Text(
                  'BLOCKCHAIN RECEIPT',
                  style: GoogleFonts.dmSans(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: TruxifyColors.hintText,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFF5F5F5),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Trip',
                      style: GoogleFonts.dmSans(
                        fontSize: 11,
                        color: TruxifyColors.hintText,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      widget.trip.route,
                      style: GoogleFonts.dmSans(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: TruxifyColors.primaryText,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Hash',
                      style: GoogleFonts.dmSans(
                        fontSize: 11,
                        color: TruxifyColors.hintText,
                      ),
                    ),
                    const SizedBox(height: 2),
                    SelectableText(
                      widget.trip.hash,
                      style: GoogleFonts.robotoMono(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: TruxifyColors.accent,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Center(
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                  decoration: BoxDecoration(
                    color: TruxifyColors.accentLight,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    '✓ Verified on Polygon',
                    style: GoogleFonts.dmSans(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: TruxifyColors.accent,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: TruxifyColors.border),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: Text(
                    'Close',
                    style: GoogleFonts.dmSans(
                      color: TruxifyColors.primaryText,
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
          ),
        );
      },
    );
  }

  Widget _buildPaymentRow(String label, String value, {bool isHeader = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: GoogleFonts.dmSans(
              fontSize: 13,
              color: TruxifyColors.hintText,
            ),
          ),
          Text(
            value,
            style: GoogleFonts.dmSans(
              fontSize: 13,
              fontWeight: isHeader ? FontWeight.bold : FontWeight.w500,
              color: isHeader
                  ? TruxifyColors.primaryText
                  : TruxifyColors.primaryText,
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    final breakdown = trip.paymentBreakdown;

    return Scaffold(
      backgroundColor: const Color(0xFFF7F3F3),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: const BackButton(color: TruxifyColors.primaryText),
        title: Text(
          'Trip Details',
          style: GoogleFonts.dmSans(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: TruxifyColors.primaryText,
          ),
        ),
        actions: [
          Center(
            child: Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Text(
                trip.tripId,
                style: GoogleFonts.dmSans(
                  fontSize: 12,
                  color: TruxifyColors.hintText,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ),
        ],
        shape: const Border(
          bottom: BorderSide(color: TruxifyColors.border, width: 1),
        ),
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 1. Route Hero Card
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [TruxifyColors.accent, Color(0xFF5E0B0B)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    trip.route,
                    style: GoogleFonts.dmSans(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    trip.date,
                    style: GoogleFonts.dmSans(
                      color: Colors.white.withOpacity(0.7),
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      Expanded(
                        child: Column(
                          children: [
                            Text(
                              trip.distance,
                              style: GoogleFonts.dmSans(
                                color: Colors.white,
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Distance',
                              style: GoogleFonts.dmSans(
                                color: Colors.white.withOpacity(0.5),
                                fontSize: 10,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        width: 1,
                        height: 28,
                        color: Colors.white.withOpacity(0.15),
                      ),
                      Expanded(
                        child: Column(
                          children: [
                            Text(
                              trip.duration,
                              style: GoogleFonts.dmSans(
                                color: Colors.white,
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Duration',
                              style: GoogleFonts.dmSans(
                                color: Colors.white.withOpacity(0.5),
                                fontSize: 10,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        width: 1,
                        height: 28,
                        color: Colors.white.withOpacity(0.15),
                      ),
                      Expanded(
                        child: Column(
                          children: [
                            Text(
                              trip.earnings,
                              style: GoogleFonts.dmSans(
                                color: Colors.white,
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Earnings',
                              style: GoogleFonts.dmSans(
                                color: Colors.white.withOpacity(0.5),
                                fontSize: 10,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // 2. Map Section — render OSM map with route polyline when available
            Container(
              margin: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: TruxifyColors.border),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: Column(
                  children: [
                    SizedBox(
                      height: 180,
                      child: FutureBuilder<_RouteResult?>(
                        future: _routeFuture,
                        builder: (context, snap) {
                          if (snap.connectionState != ConnectionState.done) {
                            return Container(
                              color: const Color(0xFFF0E8E8),
                              child: const Center(
                                  child: CircularProgressIndicator()),
                            );
                          }

                          final result = snap.data;
                          if (result == null ||
                              (result.start == null && result.end == null)) {
                            return Container(
                              color: const Color(0xFFF0E8E8),
                              child: Stack(
                                children: [
                                  Positioned(
                                    left: 50,
                                    right: 50,
                                    top: 80,
                                    height: 2,
                                    child: Row(
                                      children: List.generate(
                                        20,
                                        (index) => Expanded(
                                          child: Container(
                                            color: index % 2 == 0
                                                ? TruxifyColors.accent
                                                : Colors.transparent,
                                            height: 2,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                  const Positioned(
                                    left: 0,
                                    right: 0,
                                    top: 62,
                                    child: Center(
                                      child: Text('🚛',
                                          style: TextStyle(fontSize: 20)),
                                    ),
                                  ),
                                ],
                              ),
                            );
                          }

                          final routePoints = result.routePoints;
                          final center = _computeCenter(
                              routePoints, result.start, result.end);
                          final zoom = _computeZoom(
                              routePoints, result.start, result.end);

                          return FlutterMap(
                            mapController: _mapController,
                            options: MapOptions(
                              initialCenter: center,
                              initialZoom: zoom,
                              interactionOptions: const InteractionOptions(
                                  flags: InteractiveFlag.all),
                            ),
                            children: [
                              TileLayer(
                                urlTemplate:
                                    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                                userAgentPackageName: 'com.truxify.driver',
                              ),
                              if (routePoints.isNotEmpty)
                                PolylineLayer(
                                  polylines: [
                                    Polyline(
                                      points: routePoints,
                                      strokeWidth: 4.0,
                                      color: TruxifyColors.accent,
                                      borderStrokeWidth: 1.5,
                                      borderColor:
                                          Colors.white.withOpacity(0.8),
                                    ),
                                  ],
                                ),
                              MarkerLayer(
                                markers: [
                                  if (result.start != null)
                                    Marker(
                                      point: result.start!,
                                      width: 20,
                                      height: 20,
                                      child: Container(
                                        decoration: const BoxDecoration(
                                            shape: BoxShape.circle,
                                            color: TruxifyColors.accent),
                                      ),
                                    ),
                                  if (result.end != null)
                                    Marker(
                                      point: result.end!,
                                      width: 20,
                                      height: 20,
                                      child: Container(
                                        decoration: const BoxDecoration(
                                            shape: BoxShape.circle,
                                            color: TruxifyColors.success),
                                      ),
                                    ),
                                ],
                              ),
                            ],
                          );
                        },
                      ),
                    ),
                    // Map CTA Button
                    Padding(
                      padding: const EdgeInsets.all(12.0),
                      child: InkWell(
                        onTap: _openGoogleMapsRoute,
                        borderRadius: BorderRadius.circular(10),
                        child: Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          decoration: BoxDecoration(
                            color: TruxifyColors.accent,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.map_outlined,
                                  color: Colors.white, size: 16),
                              const SizedBox(width: 8),
                              Text(
                                'View Full Route on Google Maps',
                                style: GoogleFonts.dmSans(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w600,
                                    fontSize: 13),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // 3. Items Section
            Padding(
              padding: const EdgeInsets.only(
                  left: 16, right: 16, top: 12, bottom: 8),
              child: Text(
                'ITEMS IN THIS TRIP',
                style: GoogleFonts.dmSans(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: TruxifyColors.hintText,
                  letterSpacing: 0.5,
                ),
              ),
            ),

            if (trip.tripItems.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: TruxifyColors.border),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Center(
                    child: Text(
                      'No items declared',
                      style: GoogleFonts.dmSans(
                        color: TruxifyColors.hintText,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ),
              )
            else
              ...trip.tripItems.map((item) {
                return Container(
                  margin:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: TruxifyColors.border),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: item.delivered
                              ? TruxifyColors.success
                              : TruxifyColors.errorRed,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item.customerName,
                              style: GoogleFonts.dmSans(
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                                color: TruxifyColors.primaryText,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Row(
                              children: [
                                Text(
                                  item.goods,
                                  style: GoogleFonts.dmSans(
                                    fontSize: 11,
                                    color: TruxifyColors.hintText,
                                  ),
                                ),
                                Text(
                                  ' → ${item.destination}',
                                  style: GoogleFonts.dmSans(
                                    fontSize: 11,
                                    color: TruxifyColors.accent,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      Text(
                        item.earnings,
                        style: GoogleFonts.dmSans(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.accent,
                        ),
                      ),
                    ],
                  ),
                );
              }),

            // 4. Payment Breakdown
            Container(
              margin: const EdgeInsets.all(16),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                border: Border.all(color: TruxifyColors.border),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Payment Breakdown',
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: TruxifyColors.primaryText,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildPaymentRow(
                      'Base freight', breakdown?.baseFreight ?? '₹0'),
                  const Divider(color: TruxifyColors.border),
                  _buildPaymentRow(
                      'Fuel deducted', breakdown?.fuelDeducted ?? '₹0'),
                  const Divider(color: TruxifyColors.border),
                  _buildPaymentRow(
                      'Toll deducted', breakdown?.tollDeducted ?? '₹0'),
                  const Divider(color: TruxifyColors.border),
                  _buildPaymentRow(
                      'Platform fee', breakdown?.platformFee ?? '₹0'),
                  const Divider(thickness: 1.5, color: TruxifyColors.border),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Net earnings',
                        style: GoogleFonts.dmSans(
                          fontSize: 13,
                          color: TruxifyColors.hintText,
                        ),
                      ),
                      Text(
                        breakdown?.netEarnings ?? '₹0',
                        style: GoogleFonts.dmSans(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.accent,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // 5. Blockchain Receipt
            Container(
              margin: const EdgeInsets.only(left: 16, right: 16, bottom: 24),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.white,
                border: Border.all(color: TruxifyColors.border),
                borderRadius: BorderRadius.circular(16),
              ),
              child: GestureDetector(
                onTap: () => _showBlockchainBottomSheet(context),
                behavior: HitTestBehavior.opaque,
                child: Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        color: TruxifyColors.accentLight,
                      ),
                      child: const Center(
                        child: Icon(
                          Icons.shield_outlined,
                          color: TruxifyColors.accent,
                          size: 18,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Blockchain Receipt',
                            style: GoogleFonts.dmSans(
                              fontSize: 14,
                              fontWeight: FontWeight.w500,
                              color: TruxifyColors.primaryText,
                            ),
                          ),
                          Text(
                            'Verified on Polygon · ${trip.hash.substring(0, min(18, trip.hash.length))}',
                            style: GoogleFonts.robotoMono(
                              fontSize: 11,
                              color: TruxifyColors.hintText,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Icon(
                      Icons.chevron_right,
                      color: Color(0xFFCCBBBB),
                      size: 22,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<_RouteResult?> _loadRouteForTrip(String routeLabel) async {
    try {
      final parts = routeLabel.split('→');
      final startLabel = parts.isNotEmpty ? parts[0].trim() : '';
      final endLabel = parts.length > 1 ? parts[1].trim() : '';

      final start = startLabel.isNotEmpty
          ? await GeocodeService.resolvePlace(startLabel)
          : null;
      final end = endLabel.isNotEmpty
          ? await GeocodeService.resolvePlace(endLabel)
          : null;

      List<ll.LatLng> routePoints = <ll.LatLng>[];
      if (start != null && end != null) {
        // RouteService expects lat,long order via LatLng
        routePoints = await RouteService.fetchRouteGeoJson([
          ll.LatLng(start.latitude, start.longitude),
          ll.LatLng(end.latitude, end.longitude)
        ]);
      }

      final result = _RouteResult(start: start, end: end, routePoints: routePoints);
      return result;
    } catch (_) {
      return null;
    }
  }

  ll.LatLng _computeCenter(
      List<ll.LatLng> routePoints, ll.LatLng? start, ll.LatLng? end) {
    if (routePoints.isNotEmpty) {
      final lats = routePoints.map((p) => p.latitude).toList(growable: false);
      final lngs = routePoints.map((p) => p.longitude).toList(growable: false);
      final minLat = lats.reduce(min);
      final maxLat = lats.reduce(max);
      final minLng = lngs.reduce(min);
      final maxLng = lngs.reduce(max);
      return ll.LatLng((minLat + maxLat) / 2, (minLng + maxLng) / 2);
    }

    if (start != null && end != null) {
      return ll.LatLng((start.latitude + end.latitude) / 2,
          (start.longitude + end.longitude) / 2);
    }

    return start ?? end ?? ll.LatLng(22.9734, 78.6569);
  }

  double _computeZoom(
      List<ll.LatLng> routePoints, ll.LatLng? start, ll.LatLng? end) {
    double spanLat, spanLng;
    if (routePoints.isNotEmpty) {
      final lats = routePoints.map((p) => p.latitude).toList(growable: false);
      final lngs = routePoints.map((p) => p.longitude).toList(growable: false);
      spanLat = lats.reduce(max) - lats.reduce(min);
      spanLng = lngs.reduce(max) - lngs.reduce(min);
    } else if (start != null && end != null) {
      spanLat = (start.latitude - end.latitude).abs();
      spanLng = (start.longitude - end.longitude).abs();
    } else {
      return 6.0;
    }

    final span = max(spanLat, spanLng);
    if (span < 0.05) return 13.5;
    if (span < 0.15) return 12.0;
    if (span < 0.35) return 10.4;
    if (span < 0.9) return 8.8;
    if (span < 2.5) return 7.4;
    return 6.0;
  }
}

class _RouteResult {
  const _RouteResult({this.start, this.end, required this.routePoints});
  final ll.LatLng? start;
  final ll.LatLng? end;
  final List<ll.LatLng> routePoints;
}
