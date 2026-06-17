// ignore_for_file: unused_element, unused_field

import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' as ll;
import 'package:truxify_driver/widgets/slide_to_confirm_button.dart';

import '../core/app_routes.dart';
import '../data/mock_data.dart';
import '../models/app_models.dart';
import '../services/geocode_service.dart';
import '../services/marketplace_repository.dart';
import '../services/route_service.dart';
import '../services/trip_service.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import '../widgets/map_markers.dart';
import 'destination_picker_screen.dart';
import '../widgets/pulsing_location_dot.dart';

class HomeScreen extends StatefulWidget {
  HomeScreen({
    super.key,
    MarketplaceRepository? marketplaceRepo,
    this.mockLocationText,
  }) : marketplaceRepo = marketplaceRepo ?? MarketplaceRepository();

  final MarketplaceRepository marketplaceRepo;
  final String? mockLocationText;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  // Null until GPS resolves — no hardcoded coordinates anywhere
  ll.LatLng? _currentLocation;

  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  final MapController _mapController = MapController();
  final double _mapZoom = 5.7;

  Future<List<ll.LatLng>>? _routeFuture;
  DestinationPickResult? _destination;
  bool _isSearchExpanded = false;
  bool _isDestinationExpanded = false;
  bool _isOnline = true;
  bool _isRefreshingLocation = false;
  String? _currentLocationText;
  bool _isTripStarted = false;
  bool _showStatusCard = true;
  final TripService _tripService = TripService();
  String? _activeTripId;
  bool _isLoadingLocation = true;
  String? _locationError;

  late final MarketplaceRepository _marketplaceRepo;
  StreamSubscription<LoadOffer>? _loadSubscription;
  Timer? _autoHideTimer;
  LoadOffer? _latestNewLoad;
  bool _dismissedNewLoad = false;

  @override
  void initState() {
    super.initState();
    _marketplaceRepo = widget.marketplaceRepo;
    if (widget.mockLocationText != null) {
      _currentLocationText = widget.mockLocationText;
    }
    _initLocation();
    _subscribeToNewLoads();
  }

  @override
  void didUpdateWidget(HomeScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.mockLocationText != oldWidget.mockLocationText) {
      setState(() {
        _currentLocationText = widget.mockLocationText;
      });
    }
  }

  @override
  void dispose() {
    _loadSubscription?.cancel();
    _autoHideTimer?.cancel();
    _mapController.dispose();
    _searchController.dispose();
    _searchFocusNode.dispose();
    super.dispose();
  }

  bool _isLoadMatching(LoadOffer load) {
    if (_currentLocationText != null && _currentLocationText!.isNotEmpty) {
      final locationLower = _currentLocationText!.toLowerCase();
      final routeLower = load.route.toLowerCase();
      final pickupLower = load.pickup.toLowerCase();

      final parts = locationLower
          .split(',')
          .map((s) => s.trim())
          .where((s) => s.length >= 3);

      for (final part in parts) {
        if (routeLower.contains(part) || pickupLower.contains(part)) {
          return true;
        }
      }
      return false;
    }
    return true;
  }

  void _subscribeToNewLoads() {
    try {
      _loadSubscription = _marketplaceRepo.subscribeToNewLoads().listen((load) {
        if (!mounted) return;
        if (!_isLoadMatching(load)) return;

        _autoHideTimer?.cancel();
        setState(() {
          _latestNewLoad = load;
          _dismissedNewLoad = false;
        });

        _autoHideTimer = Timer(const Duration(seconds: 6), () {
          if (mounted) {
            setState(() {
              _dismissedNewLoad = true;
            });
          }
        });
      });
    } catch (_) {
      // Supabase not available (e.g. in tests)
    }
  }

  /// Called once on startup — fetches GPS and resolves address.
  Future<void> _initLocation() async {
    if (widget.mockLocationText != null) {
      setState(() {
        _currentLocationText = widget.mockLocationText;
        _isLoadingLocation = false;
      });
      return;
    }

    setState(() {
      _isLoadingLocation = true;
      _locationError = null;
    });

    final position = await _fetchGpsPosition();

    if (!mounted) return;

    if (position != null) {
      setState(() {
        _currentLocation = ll.LatLng(position.latitude, position.longitude);
        _isLoadingLocation = false;
      });
      final address = await _resolveCurrentLocationAddress();
      if (!mounted) return;
      setState(() {
        _currentLocationText = address;
      });
      await _loadActiveTrip();
    } else {
      setState(() {
        _isLoadingLocation = false;
        // _currentLocation stays null — map shows error state
        _currentLocationText = null;
      });
    }
  }

  /// Requests permission and fetches the current GPS position.
  /// Returns null if permission denied or location unavailable.
  Future<Position?> _fetchGpsPosition() async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      debugPrint('Location service enabled: $serviceEnabled');

      if (!serviceEnabled) {
        if (mounted) {
          setState(() {
            _locationError = 'Location services are disabled.';
          });
        }
        await Geolocator.openLocationSettings();
        return null;
      }

      LocationPermission permission = await Geolocator.checkPermission();
      debugPrint('Initial permission: $permission');

      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        debugPrint('Permission after request: $permission');

        if (permission == LocationPermission.denied) {
          if (mounted) {
            setState(() {
              _locationError = 'Location permission denied.';
            });
          }
          return null;
        }
      }

      if (permission == LocationPermission.deniedForever) {
        if (mounted) {
          setState(() {
            _locationError =
                'Location permission permanently denied. Enable it in Settings.';
          });
          _showLocationSettingsDialog();
        }
        return null;
      }

      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );

      debugPrint(
        'Latitude: ${position.latitude}, Longitude: ${position.longitude}',
      );

      return position;
    } catch (e, stackTrace) {
      debugPrint('====================');
      debugPrint('LOCATION ERROR');
      debugPrint(e.toString());
      debugPrint(stackTrace.toString());
      debugPrint('====================');

      if (mounted) {
        setState(() {
          _locationError = e.toString();
        });
      }
      return null;
    }
  }

  void _showLocationSettingsDialog() {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Location Permission Required'),
        content: const Text(
          'Location access is permanently denied. Please enable it in your device Settings to use this feature.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              Geolocator.openAppSettings();
            },
            child: const Text('Open Settings'),
          ),
        ],
      ),
    );
  }

  /// Tap on the current location row — refreshes GPS + address.
  Future<void> _fetchCurrentLocation() async {
    setState(() {
      _isRefreshingLocation = true;
      _locationError = null;
    });

    final position = await _fetchGpsPosition();

    if (!mounted) return;

    if (position != null) {
      setState(() {
        _currentLocation = ll.LatLng(position.latitude, position.longitude);
      });
      final address = await _resolveCurrentLocationAddress();
      if (!mounted) return;
      setState(() {
        _currentLocationText = address;
        _isRefreshingLocation = false;
      });
    } else {
      setState(() {
        _isRefreshingLocation = false;
        _currentLocationText = null;
      });
    }
  }

  /// Reverse geocodes `_currentLocation` using Nominatim.
  Future<String> _resolveCurrentLocationAddress() async {
    if (_currentLocation == null) return 'Location Unavailable';

    final uri = Uri.https(
      'nominatim.openstreetmap.org',
      '/reverse',
      <String, String>{
        'lat': _currentLocation!.latitude.toStringAsFixed(6),
        'lon': _currentLocation!.longitude.toStringAsFixed(6),
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

      if (response.statusCode != 200) return 'Location Unavailable';

      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) {
        final displayName = (decoded['display_name'] as String?)?.trim();
        if (displayName != null && displayName.isNotEmpty) return displayName;
      }
    } catch (_) {
      return 'Location Unavailable';
    }

    return 'Location Unavailable';
  }

  void _centerMapOnCurrentLocation() {
    if (_currentLocation == null) return;
    _mapController.move(_currentLocation!, _mapZoom);
  }

  Future<void> _loadActiveTrip() async {
    if (!_isOnline) return;
    try {
      final trips = await _tripService.fetchTrips(status: 'active');
      if (trips.isNotEmpty) {
        final activeTrip = trips.first;
        final tripId = activeTrip['trip_display_id'] as String;
        final stops = await _tripService.fetchTripStops(tripId);
        if (!mounted) return;
        
        setState(() {
          _activeTripId = tripId;
          _isTripStarted = stops.any((s) => s['is_completed'] == true || s['is_current'] == true);
        });
        
        if (stops.isNotEmpty) {
          final lastStop = stops.last;
          final address = lastStop['drop_location'] as String;
          final dropPoint = await GeocodeService.resolvePlace(address);
          if (dropPoint != null && mounted) {
            setState(() {
              _destination = DestinationPickResult(address: address, point: dropPoint);
              final routePoints = <ll.LatLng>[_currentLocation ?? dropPoint, dropPoint];
              _routeFuture = RouteService.fetchRouteGeoJson(routePoints).onError(
                (_, __) => routePoints,
              );
            });
          }
        }
      } else {
        if (mounted) {
          setState(() {
            _activeTripId = null;
            _isTripStarted = false;
            _destination = null;
            _routeFuture = null;
          });
        }
      }
    } catch (e) {
      debugPrint('Error loading active trip: $e');
    }
  }

  Future<void> _toggleOnlineState() async {
    final newStatus = !_isOnline;
    setState(() => _isOnline = newStatus);
    try {
      await _tripService.updateOnlineStatus(newStatus);
      if (newStatus) {
        await _loadActiveTrip();
      } else {
        if (mounted) {
          setState(() {
            _activeTripId = null;
            _isTripStarted = false;
            _destination = null;
            _routeFuture = null;
          });
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isOnline = !newStatus);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update status: $e')),
        );
      }
    }
  }

  void _onMapTap(ll.LatLng point) {
    if (_currentLocation == null) return;
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
      final routePoints = <ll.LatLng>[_currentLocation!, point];
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
        final routePoints = <ll.LatLng>[
          if (_currentLocation != null) _currentLocation!,
          result.point,
        ];
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

 Future<void> _completeRide() async {
  if (_activeTripId != null) {
    try {
      final stops = await _tripService.fetchTripStops(_activeTripId!);
      final currentStop = stops.where((s) => s['is_current'] == true).firstOrNull;
      if (currentStop != null) {
        await _tripService.markStopCompleted(currentStop['id'], _activeTripId!);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to complete trip: $e')),
        );
      }
      return;
    }
  }
  _clearDestination();
  if (mounted) {
    setState(() {
      _activeTripId = null;
      _isTripStarted = false;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Trip completed! Net earnings added to wallet.'),
        backgroundColor: TruxifyColors.success,
      ),
    );
  }
}

  /// Short readable label for the current location.
  String get _currentLocationLabel {
    if (_isLoadingLocation) return 'Locating...';
    if (_locationError != null) return 'Location Unavailable';
    if (_currentLocationText != null && _currentLocationText!.isNotEmpty) {
      final parts = _currentLocationText!.split(',');
      return parts.first.trim();
    }
    return 'Current Location';
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

            // New Load Notification Banner
            if (_latestNewLoad != null && !_dismissedNewLoad)
              Positioned(
                left: 12,
                right: 12,
                top: 96,
                child: GestureDetector(
                  onTap: () {
                    setState(() => _dismissedNewLoad = true);
                    Navigator.of(context).pushNamed(
                      AppRoutes.loadDetail,
                      arguments: _latestNewLoad,
                    );
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      color: TruxifyColors.accent,
                      borderRadius: BorderRadius.circular(14),
                      boxShadow: [
                        BoxShadow(
                          color: TruxifyColors.accent.withOpacity(0.25),
                          blurRadius: 12,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.local_shipping_rounded,
                            color: Colors.white, size: 18),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                'New Load Available!',
                                style: GoogleFonts.dmSans(
                                  fontSize: 13,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.white,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                _latestNewLoad!.route,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: GoogleFonts.dmSans(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                  color: Colors.white,
                                ),
                              ),
                              const SizedBox(height: 1),
                              Text(
                                '${_latestNewLoad!.weight != '—' ? '${_latestNewLoad!.weight} ' : ''}${_latestNewLoad!.goods} • ${_latestNewLoad!.estimatedProfit}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: GoogleFonts.dmSans(
                                  fontSize: 10,
                                  color: Colors.white.withOpacity(0.85),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 10),
                        GestureDetector(
                          key: const Key('realtime_notification_view_button'),
                          onTap: () {
                            setState(() => _dismissedNewLoad = true);
                            Navigator.of(context).pushNamed(
                              AppRoutes.loadDetail,
                              arguments: _latestNewLoad,
                            );
                          },
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 6),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              'View',
                              style: GoogleFonts.dmSans(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: TruxifyColors.accent,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        GestureDetector(
                          key: const Key('realtime_notification_close_button'),
                          onTap: () {
                            setState(() => _dismissedNewLoad = true);
                          },
                          child: Icon(
                            Icons.close_rounded,
                            color: Colors.white.withOpacity(0.7),
                            size: 20,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

            // Recenter FAB — hidden until GPS is ready
            if (_currentLocation != null)
              AnimatedPositioned(
                duration: const Duration(milliseconds: 300),
                curve: Curves.easeInOut,
                right: 16,
                bottom:
                    _showStatusCard ? (_destination == null ? 220 : 270) : 32,
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
                  offset:
                      _showStatusCard ? Offset.zero : const Offset(0, 1.2),
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
      'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
      'may': 5, 'jun': 6, 'jul': 7, 'aug': 8,
      'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
    };
    final month = monthMap[parts[1].toLowerCase()];
    if (month == null) return null;

    return DateTime(year, month, day);
  }

  Widget _buildMapBody(BuildContext context,
      {required bool showDestinationChip}) {
    // Show loading spinner while GPS is being fetched
    if (_isLoadingLocation) {
      return Container(
        color: Theme.of(context).colorScheme.surfaceContainerLowest,
        child: const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('Fetching your location...'),
            ],
          ),
        ),
      );
    }

    // Show error state if GPS failed and no location available
    if (_currentLocation == null) {
      return Container(
        color: Theme.of(context).colorScheme.surfaceContainerLowest,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.location_off_rounded,
                  size: 48, color: TruxifyColors.errorRed),
              const SizedBox(height: 12),
              Text(
                _locationError ?? 'Location unavailable',
                textAlign: TextAlign.center,
                style: GoogleFonts.dmSans(fontSize: 14),
              ),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: _initLocation,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }

    if (_destination == null) {
      return FlutterMap(
        mapController: _mapController,
        options: MapOptions(
          initialCenter: _currentLocation!,
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
          Future.value(<ll.LatLng>[_currentLocation!, _destination!.point]),
      builder: (context, snap) {
        final routePoints = (snap.connectionState == ConnectionState.done &&
                snap.hasData &&
                snap.data!.length >= 2)
            ? snap.data!
            : <ll.LatLng>[_currentLocation!, _destination!.point];

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
                  point: _currentLocation!,
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
                        child:
                            RouteCheckpointMarker(label: '${entry.key + 1}'),
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
                Container(width: 1, height: 12, color: TruxifyColors.border),
                const Icon(Icons.location_on_rounded,
                    size: 14, color: TruxifyColors.errorRed),
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
                            child: _isLoadingLocation
                                ? Text(
                                    'Fetching your location...',
                                    style: GoogleFonts.dmSans(
                                      fontSize: 13,
                                      color:
                                          TruxifyColors.adaptiveSecondaryText(
                                              context),
                                    ),
                                  )
                                : _locationError != null
                                    ? Text(
                                        _locationError!,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: GoogleFonts.dmSans(
                                          fontSize: 13,
                                          color: TruxifyColors.errorRed,
                                        ),
                                      )
                                    : Text(
                                        _currentLocationText ??
                                            'Tap to refresh location',
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: GoogleFonts.dmSans(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600,
                                          color: Theme.of(context)
                                              .colorScheme
                                              .onSurface,
                                        ),
                                      ),
                          ),
                          _isRefreshingLocation || _isLoadingLocation
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 1.5,
                                    color: TruxifyColors.accent,
                                  ),
                                )
                              : Icon(
                                  _locationError != null
                                      ? Icons.error_outline_rounded
                                      : Icons.refresh_rounded,
                                  size: 16,
                                  color: _locationError != null
                                      ? TruxifyColors.errorRed
                                      : TruxifyColors.adaptiveSecondaryText(
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
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
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
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: _isOnline ? TruxifyColors.success : TruxifyColors.secondaryText,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: (_isOnline ? TruxifyColors.success : TruxifyColors.secondaryText).withOpacity(0.4),
                          blurRadius: 6,
                          spreadRadius: 2,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    _isOnline ? 'Online & Ready' : 'Offline',
                    style: GoogleFonts.dmSans(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                ],
              ),
              Switch(
                value: _isOnline,
                onChanged: (_) => _toggleOnlineState(),
                activeColor: TruxifyColors.success,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            !_isOnline
                ? 'Offline. Go online to receive load assignments.'
                : _isLoadingLocation
                    ? 'Radar active. Fetching your location...'
                    : 'Radar active. Looking for load assignments near $_currentLocationLabel...',
            style: GoogleFonts.dmSans(
              fontSize: 11,
              color: TruxifyColors.adaptiveSecondaryText(context),
            ),
          ),
          const SizedBox(height: 16),
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
      {required IconData icon,
      required String value,
      required String label}) {
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

  Future<void> _openGoogleMapsRoute() async {
    if (_destination == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No destination available')),
      );
      return;
    }

    if (_currentLocation == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Current location unavailable. Please retry.')),
      );
      return;
    }

    try {
      final destination = _destination!.point;

      final routePoints = await (_routeFuture ??
          Future.value([_currentLocation!, destination]));

      final checkpoints = _buildCheckpointPoints(routePoints);

      final waypointString =
          checkpoints.map((p) => '${p.latitude},${p.longitude}').join('|');

      final url = 'https://www.google.com/maps/dir/?api=1'
          '&origin=${_currentLocation!.latitude},${_currentLocation!.longitude}'
          '&destination=${destination.latitude},${destination.longitude}'
          '${waypointString.isNotEmpty ? '&waypoints=$waypointString' : ''}'
          '&travelmode=driving';

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
          const SnackBar(content: Text('Failed to generate route')),
        );
      }
    }
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
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
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
              IconButton(
                icon: const Icon(Icons.navigation_rounded),
                color: TruxifyColors.accent,
                onPressed: _openGoogleMapsRoute,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '$_currentLocationLabel → $routeStr',
            style: GoogleFonts.dmSans(
              fontSize: 15,
              fontWeight: FontWeight.bold,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
          const SizedBox(height: 12),
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
                backgroundColor:
                    Theme.of(context).brightness == Brightness.dark
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
              onConfirmed: () async {
              await _completeRide();
              },
            ),
          ] else ...[
            SlideToConfirmButton(
              label: 'Slide to Start Trip',
              backgroundColor: TruxifyColors.accent,
              onConfirmed: () async {
                if (_activeTripId == null) {
                  setState(() => _isTripStarted = true);
                  return;
                }
                try {
                  await _tripService.startTrip(_activeTripId!);
                  if (mounted) {
                    setState(() => _isTripStarted = true);
                  }
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Failed to start trip: $e')),
                    );
                  }
                }
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