// ignore_for_file: unused_element, unused_field

import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' as ll;
import 'package:truxify_driver/widgets/slide_to_confirm_button.dart';

import '../core/app_routes.dart';
import '../data/mock_data.dart';
import '../services/route_service.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import '../widgets/map_markers.dart';
import 'destination_picker_screen.dart';
import '../widgets/pulsing_location_dot.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const ll.LatLng _currentLocation = ll.LatLng(21.1702, 72.8311);
  static const String _currentLocationLabel = 'Surat Yard';

  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  final MapController _mapController = MapController();
  double _mapZoom = 5.7;

  Future<List<ll.LatLng>>? _routeFuture;
  DestinationPickResult? _destination;
  bool _isSearchExpanded = false;
  bool _isDestinationExpanded = false;
  bool _isOnline = true;
  bool _isRefreshingLocation = false;
  String? _currentLocationText = _currentLocationLabel;
  bool _isTripStarted = false;
  bool _showStatusCard = true;

  @override
  void dispose() {
    _mapController.dispose();
    _searchController.dispose();
    _searchFocusNode.dispose();
    super.dispose();
  }

  void _expandSearchBar() {
    if (_isSearchExpanded) return;
    setState(() => _isSearchExpanded = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _searchFocusNode.requestFocus();
      }
    });
  }

  void _collapseSearchBar() {
    if (!_isSearchExpanded) return;
    setState(() => _isSearchExpanded = false);
  }

  Future<void> _fetchCurrentLocation() async {
    setState(() {
      _isRefreshingLocation = true;
    });

    final resolvedLocation = await _resolveCurrentLocationAddress();

    if (!mounted) {
      return;
    }

    setState(() {
      _currentLocationText = resolvedLocation;
      _isRefreshingLocation = false;
    });
  }

  Future<String> _resolveCurrentLocationAddress() async {
    final uri = Uri.https(
      'nominatim.openstreetmap.org',
      '/reverse',
      <String, String>{
        'lat': _currentLocation.latitude.toStringAsFixed(6),
        'lon': _currentLocation.longitude.toStringAsFixed(6),
        'format': 'jsonv2',
      },
    );

    try {
      final response = await http.get(
        uri,
        headers: const <String, String>{
          'Accept': 'application/json',
          'User-Agent': 'Truxify Driver App',
        },
      );

      if (response.statusCode != 200) {
        return _currentLocationLabel;
      }

      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) {
        final displayName = (decoded['display_name'] as String?)?.trim();
        if (displayName != null && displayName.isNotEmpty) {
          return displayName;
        }
      }
    } catch (_) {
      return _currentLocationLabel;
    }

    return _currentLocationLabel;
  }

  void _centerMapOnCurrentLocation() {
    _mapController.move(_currentLocation, _mapZoom);
  }

  void _toggleOnlineState() {
    setState(() {
      _isOnline = !_isOnline;
    });
  }

  void _onMapTap(ll.LatLng point) {
    if (!_isOnline) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please go online to set destinations')),
      );
      return;
    }
    if (!_isDestinationExpanded) return;
    setState(() {
      _destination =
          DestinationPickResult(address: 'Pinned location', point: point);
      _searchController.text = _destination!.address;
      _isDestinationExpanded = false;
      final routePoints = <ll.LatLng>[_currentLocation, point];
      _routeFuture = RouteService.fetchRouteGeoJson(routePoints).onError(
        (_, __) => routePoints,
      );
    });
  }

  Future<void> _openDestinationPicker() async {
    if (!_isOnline) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Please go online to search destinations')),
      );
      return;
    }
    final query = _searchController.text.trim();
    final result = await Navigator.of(context, rootNavigator: true).pushNamed(
      AppRoutes.destinationPicker,
      arguments: DestinationPickerArgs(
        title: 'Where are you going?',
        initialQuery: query.isNotEmpty ? query : _destination?.address,
        initialPoint: _destination?.point,
      ),
    );

    if (!mounted) return;

    if (result is DestinationPickResult) {
      setState(() {
        _destination = result;
        _searchController.text = result.address;
        _isSearchExpanded = false;
        final routePoints = <ll.LatLng>[_currentLocation, result.point];
        _routeFuture = RouteService.fetchRouteGeoJson(routePoints).onError(
          (_, __) => routePoints,
        );
      });
    }
  }

  void _clearDestination() {
    setState(() {
      _destination = null;
      _routeFuture = null;
      _isSearchExpanded = false;
      _isTripStarted = false;
      _searchController.clear();
    });
  }

  void _completeRide() {
    _clearDestination();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Trip completed! Net earnings added to wallet.'),
        backgroundColor: TruxifyColors.success,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        bottom: false,
        child: Stack(
          children: [
            // Map
            Positioned.fill(
              child: _buildMapBody(
                context,
                showDestinationChip: _destination != null,
              ),
            ),

            // Top Bar
            Positioned(
              left: 12,
              right: 12,
              top: 12,
              child: SafeArea(
                bottom: false,
                child: _isTripStarted
                    ? _buildActiveNavigationHeader(context)
                    : _buildSearchCard(context),
              ),
            ),

            // Recenter FAB (floated above bottom cards)
            AnimatedPositioned(
              duration: const Duration(milliseconds: 300),
              curve: Curves.easeInOut,
              right: 16,
              bottom: _showStatusCard ? (_destination == null ? 220 : 270) : 32,
              child: FloatingActionButton(
                heroTag: 'driver-home-recenter',
                onPressed: _centerMapOnCurrentLocation,
                backgroundColor: Theme.of(context).colorScheme.surface,
                foregroundColor: TruxifyColors.accent,
                elevation: 4,
                shape: const CircleBorder(),
                child: const Icon(Icons.my_location_rounded),
              ),
            ),

            // Bottom Controller Card
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: SafeArea(
                top: false,
                minimum: EdgeInsets.zero,
                child: AnimatedSlide(
                  duration: const Duration(milliseconds: 300),
                  offset: _showStatusCard ? Offset.zero : const Offset(0, 1.2),
                  child: GestureDetector(
                    onTap: () {
                      setState(() {
                        _showStatusCard = !_showStatusCard;
                      });
                    },
                    child: _destination == null
                        ? _buildBottomSheet(context)
                        : _buildActiveTripSheet(context),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActiveNavigationHeader(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: TruxifyColors.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.08),
            blurRadius: 18,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          const LivePulseDot(color: TruxifyColors.success, size: 10),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'NAVIGATION ACTIVE',
                  style: GoogleFonts.dmSans(
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    color: TruxifyColors.success,
                    letterSpacing: 0.5,
                  ),
                ),
                Text(
                  'Heading to ${_destination?.address ?? "Destination"}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.dmSans(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _formatTimeSinceLastTrip() {
    DateTime? latest;
    for (final record in tripHistory) {
      if (!record.completed) continue;
      final parsed = _parseTripHistoryDate(record.date);
      if (parsed == null) continue;
      if (latest == null || parsed.isAfter(latest)) {
        latest = parsed;
      }
    }

    if (latest == null) return '-';

    final now = DateTime.now();
    var diff = now.difference(latest);
    if (diff.isNegative) diff = diff * -1;

    if (diff.inDays >= 1) return '${diff.inDays}d ago';
    if (diff.inHours >= 1) return '${diff.inHours}h ago';
    if (diff.inMinutes >= 1) return '${diff.inMinutes}m ago';
    return 'Just now';
  }

  DateTime? _parseTripHistoryDate(String raw) {
    final parts = raw.trim().split(RegExp(r'\s+'));
    if (parts.length < 3) return null;

    final day = int.tryParse(parts[0]);
    final year = int.tryParse(parts[2]);
    if (day == null || year == null) return null;

    final monthMap = <String, int>{
      'jan': 1,
      'feb': 2,
      'mar': 3,
      'apr': 4,
      'may': 5,
      'jun': 6,
      'jul': 7,
      'aug': 8,
      'sep': 9,
      'oct': 10,
      'nov': 11,
      'dec': 12,
    };
    final month = monthMap[parts[1].toLowerCase()];
    if (month == null) return null;

    return DateTime(year, month, day);
  }

  Widget _buildMapBody(BuildContext context,
      {required bool showDestinationChip}) {
    if (_destination == null) {
      return FlutterMap(
        mapController: _mapController,
        options: MapOptions(
          initialCenter: _currentLocation,
          initialZoom: _mapZoom,
          interactionOptions: const InteractionOptions(
            flags: InteractiveFlag.all,
          ),
          onTap: (tapPosition, point) {
            setState(() {
              _showStatusCard = !_showStatusCard;
            });
            _onMapTap(point);
          },
          onPositionChanged: (position, hasGesture) {
            if (hasGesture && _showStatusCard) {
              setState(() {
                _showStatusCard = false;
              });
            }
          },
        ),
        children: [
          TileLayer(
            urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            userAgentPackageName: 'com.truxify.driver',
          ),
        ],
      );
    }

    return FutureBuilder<List<ll.LatLng>>(
      future: _routeFuture ??
          Future.value(<ll.LatLng>[_currentLocation, _destination!.point]),
      builder: (context, snap) {
        final routePoints = (snap.connectionState == ConnectionState.done &&
                snap.hasData &&
                snap.data!.length >= 2)
            ? snap.data!
            : <ll.LatLng>[_currentLocation, _destination!.point];

        final center = _routeCenter(routePoints);
        final zoom = _routeZoom(routePoints);
        final checkpoints = _buildCheckpointPoints(routePoints);

        return FlutterMap(
          mapController: _mapController,
          key: ValueKey(_destination!.address),
          options: MapOptions(
            initialCenter: center,
            initialZoom: zoom,
            interactionOptions: const InteractionOptions(
              flags: InteractiveFlag.all,
            ),
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.truxify.driver',
            ),
            PolylineLayer(
              polylines: [
                Polyline(
                  points: routePoints,
                  strokeWidth: 5.0,
                  color: TruxifyColors.accent,
                  borderStrokeWidth: 2.0,
                  borderColor: Colors.white.withOpacity(0.8),
                ),
              ],
            ),
            MarkerLayer(
              markers: [
                Marker(
                  point: _currentLocation,
                  width: 54,
                  height: 54,
                  alignment: Alignment.center,
                  child: const RouteMarker(
                    icon: Icons.my_location_rounded,
                    fillColor: TruxifyColors.success,
                    shadowColor: TruxifyColors.success,
                  ),
                ),
                ...checkpoints.asMap().entries.map(
                      (entry) => Marker(
                        point: entry.value,
                        width: 34,
                        height: 34,
                        alignment: Alignment.center,
                        child: RouteCheckpointMarker(label: '${entry.key + 1}'),
                      ),
                    ),
                Marker(
                  point: _destination!.point,
                  width: 54,
                  height: 54,
                  alignment: Alignment.center,
                  child: const RouteMarker(
                    icon: Icons.location_on_rounded,
                    fillColor: TruxifyColors.errorRed,
                    shadowColor: TruxifyColors.errorRed,
                  ),
                ),
              ],
            ),
          ],
        );
      },
    );
  }

  ll.LatLng _routeCenter(List<ll.LatLng> points) {
    final lats = points.map((p) => p.latitude).toList(growable: false);
    final lngs = points.map((p) => p.longitude).toList(growable: false);
    final minLat = lats.reduce(math.min);
    final maxLat = lats.reduce(math.max);
    final minLng = lngs.reduce(math.min);
    final maxLng = lngs.reduce(math.max);
    return ll.LatLng((minLat + maxLat) / 2, (minLng + maxLng) / 2);
  }

  double _routeZoom(List<ll.LatLng> points) {
    final lats = points.map((p) => p.latitude).toList(growable: false);
    final lngs = points.map((p) => p.longitude).toList(growable: false);
    final latSpan = lats.reduce(math.max) - lats.reduce(math.min);
    final lngSpan = lngs.reduce(math.max) - lngs.reduce(math.min);
    final span = math.max(latSpan, lngSpan);

    if (span < 0.05) return 13.5;
    if (span < 0.15) return 12.0;
    if (span < 0.35) return 10.4;
    if (span < 0.9) return 8.8;
    if (span < 2.5) return 7.4;
    return 6.2;
  }

  List<ll.LatLng> _buildCheckpointPoints(List<ll.LatLng> routePoints) {
    if (routePoints.length < 4) return const <ll.LatLng>[];

    final totalSegments = routePoints.length - 1;
    final indexes = <int>{};
    for (var step = 1; step <= 3; step++) {
      final index =
          ((totalSegments * step) / 4).round().clamp(1, totalSegments - 1);
      indexes.add(index);
    }

    return indexes.map((index) => routePoints[index]).toList(growable: false);
  }

  Widget _buildSearchCard(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: TruxifyColors.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.06),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 8, 12, 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const PulsingLocationDot(),
                Container(
                  width: 1,
                  height: 12,
                  color: TruxifyColors.border,
                ),
                const Icon(
                  Icons.location_on_rounded,
                  size: 14,
                  color: TruxifyColors.errorRed,
                ),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  GestureDetector(
                    onTap: _fetchCurrentLocation,
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              _currentLocationText ?? _currentLocationLabel,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: GoogleFonts.dmSans(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: Theme.of(context).colorScheme.onSurface,
                              ),
                            ),
                          ),
                          _isRefreshingLocation
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 1.5,
                                    color: TruxifyColors.accent,
                                  ),
                                )
                              : Icon(
                                  Icons.refresh_rounded,
                                  size: 16,
                                  color: TruxifyColors.adaptiveSecondaryText(
                                      context),
                                ),
                        ],
                      ),
                    ),
                  ),
                  const Divider(height: 12, color: TruxifyColors.border),
                  GestureDetector(
                    onTap: _openDestinationPicker,
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Text(
                        _destination?.address ?? 'Where are you heading?',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.dmSans(
                          fontSize: 13,
                          fontWeight: _destination == null
                              ? FontWeight.normal
                              : FontWeight.w600,
                          color: _destination == null
                              ? TruxifyColors.hintText
                              : TruxifyColors.primaryText,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomSheet(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(20),
        ),
        border: Border.all(color: TruxifyColors.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.06),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Shift Info Row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: TruxifyColors.success,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: TruxifyColors.success.withValues(alpha: 0.4),
                          blurRadius: 6,
                          spreadRadius: 2,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Online & Ready',
                    style: GoogleFonts.dmSans(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Radar active. Looking for load assignments near Surat Yard...',
            style: GoogleFonts.dmSans(
              fontSize: 11,
              color: TruxifyColors.adaptiveSecondaryText(context),
            ),
          ),
          const SizedBox(height: 16),
          // Stats Row
          Row(
            children: [
              Expanded(
                child: _buildShiftMetric(
                  icon: Icons.account_balance_wallet_outlined,
                  value: '₹4,800',
                  label: 'Today\'s Pay',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _buildShiftMetric(
                  icon: Icons.timer_outlined,
                  value: '6.2 hrs',
                  label: 'Shift Hours',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _buildShiftMetric(
                  icon: Icons.star_border_rounded,
                  value: '4.85',
                  label: 'Rating',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildShiftMetric(
      {required IconData icon, required String value, required String label}) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark
            ? Theme.of(context).colorScheme.surfaceContainerHighest
            : const Color(0xFFF9F7F7),
        border: Border.all(color: TruxifyColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Icon(icon, size: 16, color: TruxifyColors.accent),
          const SizedBox(height: 6),
          Text(
            value,
            style: GoogleFonts.dmSans(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
          Text(
            label,
            style: GoogleFonts.dmSans(
              fontSize: 9,
              color: TruxifyColors.adaptiveSecondaryText(context),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActiveTripSheet(BuildContext context) {
    final routeStr = _destination?.address ?? 'Destination';
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: TruxifyColors.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.08),
            blurRadius: 20,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: _isTripStarted
                      ? const Color(0xFFEAFCEE)
                      : TruxifyColors.accentLight,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  _isTripStarted ? 'EN-ROUTE' : 'ASSIGNED LOAD',
                  style: GoogleFonts.dmSans(
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                    color: _isTripStarted
                        ? TruxifyColors.success
                        : TruxifyColors.accent,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'GJ-05-BY-9898 · Tata Signa',
                  style: GoogleFonts.dmSans(
                    fontSize: 11,
                    color: TruxifyColors.adaptiveSecondaryText(context),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Surat Yard → $routeStr',
            style: GoogleFonts.dmSans(
              fontSize: 15,
              fontWeight: FontWeight.bold,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
          const SizedBox(height: 12),
          // Estimated Stats
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildTripSpec('Distance', '420 km'),
              _buildTripSpec('Est. Duration', '8.5 hrs'),
              _buildTripSpec('Est. Payout', '₹8,200'),
            ],
          ),
          const SizedBox(height: 16),
          if (_isTripStarted) ...[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Next: Dhule Plaza in 42 km',
                  style: GoogleFonts.dmSans(
                      fontSize: 11, color: TruxifyColors.secondaryText),
                ),
                Text(
                  '25% complete',
                  style: GoogleFonts.dmSans(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: TruxifyColors.success),
                ),
              ],
            ),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(
                value: 0.25,
                backgroundColor: Theme.of(context).brightness == Brightness.dark
                    ? TruxifyColors.darkBorder
                    : TruxifyColors.border,
                valueColor:
                    AlwaysStoppedAnimation<Color>(TruxifyColors.success),
                minHeight: 6,
              ),
            ),
            const SizedBox(height: 16),
            SlideToConfirmButton(
              label: 'Slide to Complete Trip',
              backgroundColor: TruxifyColors.success,
              onConfirmed: _completeRide,
            ),
          ] else ...[
            SlideToConfirmButton(
              label: 'Slide to Start Trip',
              backgroundColor: TruxifyColors.accent,
              onConfirmed: () {
                setState(() {
                  _isTripStarted = true;
                });
              },
            ),
            const SizedBox(height: 8),
            Center(
              child: InkWell(
                onTap: _clearDestination,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Text(
                    'Cancel Assignment',
                    style: GoogleFonts.dmSans(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildTripSpec(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GoogleFonts.dmSans(
            fontSize: 10,
            color: TruxifyColors.adaptiveSecondaryText(context),
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: GoogleFonts.dmSans(
            fontSize: 13,
            fontWeight: FontWeight.bold,
            color: Theme.of(context).colorScheme.onSurface,
          ),
        ),
      ],
    );
  }
}
