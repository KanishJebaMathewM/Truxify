
import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' as ll;

import '../core/app_routes.dart';
import '../l10n/app_localizations.dart';
import '../models/app_models.dart';
import '../models/earnings_daily_model.dart';
import '../services/driver_earnings_service.dart';
import '../services/geocode_service.dart';
import '../services/marketplace_repository.dart';
import '../services/route_service.dart';
import '../services/trip_service.dart';
import '../services/location_service.dart';
import '../theme/app_theme.dart';
import '../widgets/map_markers.dart';
import '../widgets/home/offline_banner.dart';
import '../widgets/home/active_navigation_header.dart';
import '../widgets/home/search_destination_card.dart';
import '../widgets/home/new_load_notification_banner.dart';
import '../widgets/home/driver_status_sheet.dart';
import '../widgets/home/active_trip_sheet.dart';
import 'destination_picker_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.marketplaceRepo,
    required this.earningsService,
    this.mockLocationText,
  });

  final MarketplaceRepository marketplaceRepo;
  final DriverEarningsService earningsService;
  final String? mockLocationText;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _isOffline = false;
  // Null until GPS resolves — no hardcoded coordinates anywhere
  ll.LatLng? _currentLocation;

  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  final MapController _mapController = MapController();
  final double _mapZoom = 5.7;

  Future<List<ll.LatLng>>? _routeFuture;
  DestinationPickResult? _destination;
  bool _isSearchExpanded = false;
  Map<String, dynamic>? _heatmapData;

  List<Marker>? _cachedMarkers;
  ll.LatLng? _lastDest;
  ll.LatLng? _lastLoc;
  int _lastCheckpointsCount = -1;

  List<Marker> _getMarkers(List<ll.LatLng> checkpoints) {
    if (_lastDest == _destination?.point &&
        _lastLoc == _currentLocation &&
        _lastCheckpointsCount == checkpoints.length &&
        _cachedMarkers != null) {
      return _cachedMarkers!;
    }

    _lastDest = _destination?.point;
    _lastLoc = _currentLocation;
    _lastCheckpointsCount = checkpoints.length;

    _cachedMarkers = [
      if (_currentLocation != null)
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
              child: RouteCheckpointMarker(
                  key: ValueKey('chk_${entry.key}'), label: '${entry.key + 1}'),
            ),
          ),
      if (_destination != null)
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
    ];
    return _cachedMarkers!;
  }

  bool _isDestinationExpanded = false;
  bool _isOnline = true;
  bool _isRefreshingLocation = false;
  String? _currentLocationText;
  bool _isTripStarted = false;
  bool _showStatusCard = true;
  final TripService _tripService = TripService();
  String? _activeTripId;
  String _activeTruckLabel = '';
  String _activeTripDistance = '';
  String _activeTripDuration = '';
  String _activeTripPayout = '';
  bool _isLoadingLocation = true;
  String? _locationError;
  late final MarketplaceRepository _marketplaceRepo;
  StreamSubscription<LoadOffer>? _loadSubscription;
  Timer? _autoHideTimer;
  LoadOffer? _latestNewLoad;
  bool _dismissedNewLoad = false;

  late final DriverEarningsService _earningsService;
  EarningsDailyModel? _todayEarnings;
  double? _driverRating;
  List<TripRecord> _tripHistory = [];
  bool _isLoadingMetrics = true;
  String? _metricsError;
  String? _networkError;
  int _retryCount = 0;

  String _sanitizeCoordinate(dynamic coord) {
    if (coord == null) return '0.0';
    if (coord is double) return coord.toStringAsFixed(6);
    if (coord is int) return coord.toStringAsFixed(6);
    return (double.tryParse(coord.toString()) ?? 0.0).toStringAsFixed(6);
  }

  void _clearNetworkError() {
    if (_networkError != null) {
      setState(() => _networkError = null);
    }
  }

  Future<void> _withRetry(Future<void> Function() fn) async {
    try {
      _retryCount = 0;
      await fn();
    } catch (e) {
      _retryCount++;
      if (_retryCount <= 3) {
        await Future.delayed(Duration(seconds: _retryCount));
        await fn();
      } else {
        setState(() => _networkError = 'Operation failed after $_retryCount retries');
      }
    }
  }

  @override
  void initState() {
    super.initState();
    _earningsService = widget.earningsService;
    _marketplaceRepo = widget.marketplaceRepo;
    if (widget.mockLocationText != null) {
      _currentLocationText = widget.mockLocationText;
    }
    _initLocation();
    _subscribeToNewLoads();
    _loadDashboardMetrics();
    _loadHeatmapData();
  }

  Future<void> _loadHeatmapData() async {
    try {
      final heatmapData = await _marketplaceRepo.fetchDemandHeatmap();
      if (mounted) {
        setState(() {
          _heatmapData = heatmapData;
        });
      }
    } catch (e) {
      debugPrint('Failed to load heatmap data: $e');
    }
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
    } catch (e) {
      debugPrint('_subscribeToNewLoads error: $e');
    }
  }

  Future<void> _loadDashboardMetrics() async {
    if (!mounted) return;
    setState(() {
      _isLoadingMetrics = true;
      _metricsError = null;
    });

    try {
      final results = await Future.wait([
        _earningsService.fetchTodayEarningsSummary().catchError((e) {
          debugPrint('Failed to fetch earnings summary: $e');
          return null;
        }),
        _earningsService.fetchDriverStats().catchError((e) {
          debugPrint('Failed to fetch driver stats: $e');
          return <String, dynamic>{};
        }),
        _tripService.fetchTripHistory(limit: 50).catchError((e) {
          debugPrint('Failed to fetch trip history: $e');
          return <String, dynamic>{'trips': []};
        }),
      ]);

      if (!mounted) return;

      final historyData = results[2] as Map<String, dynamic>;
      final historyList = (historyData['trips'] as List?)
          ?.map((t) => TripRecord(
                route: (t['route'] as String?) ?? (t['route_label'] as String?) ?? '',
                date: (t['date'] as String?) ?? (t['trip_date'] as String?) ?? '',
                earnings: (t['earnings'] as String?) ?? (t['payout'] as String?) ?? '',
                statusLabel: (t['status_label'] as String?) ?? (t['status'] as String?) ?? '',
                tripId: (t['trip_display_id'] as String?) ?? (t['trip_id'] as String?) ?? '',
                hash: (t['hash'] as String?) ?? (t['blockchain_hash'] as String?) ?? '',
                verifiedBadge: (t['verified_badge'] as String?) ?? '',
                completed: (t['completed'] as bool?) ?? (t['is_completed'] as bool?) ?? false,
              ))
          .toList() ?? [];

      setState(() {
        _todayEarnings = results[0] as EarningsDailyModel?;
        final stats = results[1] as Map<String, dynamic>? ?? <String, dynamic>{};
        _driverRating = (stats['rating'] as num?)?.toDouble();
        _tripHistory = historyList;
        _isLoadingMetrics = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoadingMetrics = false;
        _metricsError = e.toString();
      });
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
      if (_isOnline) {
        await LocationService.instance.startTracking();
      }
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
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
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
        title: Text(AppLocalizations.of(context)!.locationPermissionRequired),
        content: Text(
          AppLocalizations.of(context)!.locationPermDenied,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text(AppLocalizations.of(context)!.cancel),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              Geolocator.openAppSettings();
            },
            child: Text(AppLocalizations.of(context)!.openSettings),
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

        final truckPlate = (activeTrip['truck_plate'] as String?) ?? '';
        final truckModel = (activeTrip['truck_model'] as String?) ?? '';
        final truckLabel = truckPlate.isNotEmpty && truckModel.isNotEmpty
            ? '$truckPlate · $truckModel'
            : (activeTrip['truck_label'] as String?) ?? 'Truck assigned';

        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('cached_trip_id', tripId);
        await prefs.setString('cached_truck_label', truckLabel);
        await prefs.setString('cached_distance', (activeTrip['distance'] as String?) ?? (activeTrip['trip_distance'] as String?) ?? '');
        await prefs.setString('cached_duration', (activeTrip['duration'] as String?) ?? (activeTrip['trip_duration'] as String?) ?? '');
        await prefs.setString('cached_payout', (activeTrip['estimated_payout'] as String?) ?? (activeTrip['price'] as String?) ?? (activeTrip['payout'] as String?) ?? '');
        
        final isTripStarted = stops.any((s) => s['is_completed'] == true || s['is_current'] == true);
        await prefs.setBool('cached_is_started', isTripStarted);

        setState(() {
          _isOffline = false;
          _activeTripId = tripId;
          _activeTruckLabel = truckLabel;
          _activeTripDistance = prefs.getString('cached_distance') ?? '';
          _activeTripDuration = prefs.getString('cached_duration') ?? '';
          _activeTripPayout = prefs.getString('cached_payout') ?? '';
          _isTripStarted = isTripStarted;
        });
        
        if (stops.isNotEmpty) {
          final lastStop = stops.last;
          final address = lastStop['drop_location'] as String;
          await prefs.setString('cached_address', address);
          
          final dropPoint = await GeocodeService.resolvePlace(address);
          if (dropPoint != null) {
            await prefs.setDouble('cached_drop_lat', dropPoint.latitude);
            await prefs.setDouble('cached_drop_lng', dropPoint.longitude);
          }
          
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
        final prefs = await SharedPreferences.getInstance();
        await prefs.remove('cached_trip_id');
        if (mounted) {
          setState(() {
            _isOffline = false;
            _activeTripId = null;
            _isTripStarted = false;
            _destination = null;
            _routeFuture = null;
          });
        }
      }
    } catch (e) {
      debugPrint('Error loading active trip: $e');
      final prefs = await SharedPreferences.getInstance();
      if (prefs.getString('cached_trip_id') != null && mounted) {
        setState(() {
          _isOffline = true;
          _activeTripId = prefs.getString('cached_trip_id');
          _activeTruckLabel = prefs.getString('cached_truck_label') ?? '';
          _activeTripDistance = prefs.getString('cached_distance') ?? '';
          _activeTripDuration = prefs.getString('cached_duration') ?? '';
          _activeTripPayout = prefs.getString('cached_payout') ?? '';
          _isTripStarted = prefs.getBool('cached_is_started') ?? false;
        });
        final address = prefs.getString('cached_address');
        final lat = prefs.getDouble('cached_drop_lat');
        final lng = prefs.getDouble('cached_drop_lng');
        if (address != null && lat != null && lng != null) {
          final dropPoint = ll.LatLng(lat, lng);
          setState(() {
            _destination = DestinationPickResult(address: address, point: dropPoint);
          });
        }
      }
    }
  }

  Future<void> _toggleOnlineState() async {
    final newStatus = !_isOnline;
    setState(() => _isOnline = newStatus);
    try {
      await _tripService.updateOnlineStatus(newStatus);
      if (newStatus) {
        await _loadActiveTrip();
        await LocationService.instance.startTracking();
      } else {
        LocationService.instance.stopTracking();
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
          SnackBar(content: Text(AppLocalizations.of(context)!.error)),
        );
      }
    }
  }

  void _onMapTap(ll.LatLng point) {
    if (_currentLocation == null) return;
    if (!_isOnline) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context)!.pleaseGoOnline)),
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
        SnackBar(
            content: Text(AppLocalizations.of(context)!.pleaseGoOnline)),
      );
      return;
    }
    final query = _searchController.text.trim();
    final result = await Navigator.of(context, rootNavigator: true).pushNamed(
      AppRoutes.destinationPicker,
      arguments: DestinationPickerArgs(
        title: AppLocalizations.of(context)!.whereAreYouHeading,
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
          SnackBar(content: Text(AppLocalizations.of(context)!.failedToCompleteTrip)),
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
        content: Text(AppLocalizations.of(context)!.tripCompletedNetEarnings('')),
        backgroundColor: TruxifyColors.success,
      ),
    );
    _loadDashboardMetrics();
  }
}

  /// Short readable label for the current location.
  String _currentLocationLabel(BuildContext context) {
    if (_isLoadingLocation) return AppLocalizations.of(context)!.locating;
    if (_locationError != null) return AppLocalizations.of(context)!.locationUnavailable;
    if (_currentLocationText != null && _currentLocationText!.isNotEmpty) {
      final parts = _currentLocationText!.split(',');
      return parts.first.trim();
    }
    return AppLocalizations.of(context)!.currentLocation;
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
              child: _buildMapBody(context),
            ),

            // Top Bar
            Positioned(
              left: 12,
              right: 12,
              top: 12,
              child: SafeArea(
                bottom: false,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_isOffline)
                      Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                        decoration: BoxDecoration(
                          color: TruxifyColors.errorRed,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.cloud_off_rounded, color: Colors.white, size: 16),
                            const SizedBox(width: 8),
                            Text(
                              AppLocalizations.of(context)!.offlineUsingCachedData,
                              style: GoogleFonts.dmSans(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
                            ),
                          ],
                        ),
                      ),
                    if (_isOffline) const OfflineBanner(),
                    _isTripStarted
                        ? ActiveNavigationHeader(
                            destinationAddress:
                                _destination?.address ?? 'Destination',
                          )
                        : SearchDestinationCard(
                            currentLocationText: _currentLocationText,
                            destination: _destination,
                            isLoadingLocation: _isLoadingLocation,
                            isRefreshingLocation: _isRefreshingLocation,
                            locationError: _locationError,
                            onRefreshLocation: _fetchCurrentLocation,
                            onOpenDestinationPicker: _openDestinationPicker,
                          ),
                  ],
                ),
              ),
            ),

            // New Load Notification Banner
            if (_latestNewLoad != null && !_dismissedNewLoad)
              Positioned(
                left: 12,
                right: 12,
                top: 96,
                child: NewLoadNotificationBanner(
                  load: _latestNewLoad!,
                  onView: () {},
                  onDismiss: () {
                    setState(() => _dismissedNewLoad = true);
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      color: TruxifyColors.accent,
                      borderRadius: BorderRadius.circular(14),
                      boxShadow: [
                        BoxShadow(
                          color: TruxifyColors.accent.withValues(alpha: 0.25),
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
                                AppLocalizations.of(context)!.newLoadAvailable,
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
                                  color: Colors.white.withValues(alpha: 0.85),
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
                              AppLocalizations.of(context)!.view,
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
                            color: Colors.white.withValues(alpha: 0.7),
                            size: 20,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

            // Recenter FAB
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
                        ? DriverStatusSheet(
                            isOnline: _isOnline,
                            isLoadingLocation: _isLoadingLocation,
                            currentLocationLabel: _currentLocationLabel,
                            isLoadingMetrics: _isLoadingMetrics,
                            metricsError: _metricsError,
                            todayEarnings: _todayEarnings,
                            driverRating: _driverRating,
                            onToggleOnline: _toggleOnlineState,
                          )
                        : ActiveTripSheet(
                            isTripStarted: _isTripStarted,
                            truckLabel: _activeTruckLabel,
                            currentLocationLabel: _currentLocationLabel,
                            destinationAddress:
                                _destination?.address ?? 'Destination',
                            distance: _activeTripDistance,
                            duration: _activeTripDuration,
                            payout: _activeTripPayout,
                            onStartTrip: () async {
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
                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                        content:
                                            Text('Failed to start trip: $e')),
                                  );
                                }
                              }
                            },
                            onCompleteTrip: () async {
                              await _completeRide();
                            },
                            onCancel: _clearDestination,
                            onOpenMaps: _openGoogleMapsRoute,
                          ),
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
            color: Colors.black.withValues(alpha: 0.08),
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
                  AppLocalizations.of(context)!.navigationActive,
                  style: GoogleFonts.dmSans(
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    color: TruxifyColors.success,
                    letterSpacing: 0.5,
                  ),
                ),
                Text(
                  AppLocalizations.of(context)!.headingTo(_destination?.address ?? ''),
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
    for (final record in _tripHistory) {
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

  Widget _buildMapBody(BuildContext context) {
    // Show loading spinner while GPS is being fetched
    if (_isLoadingLocation) {
      return Container(
        color: Theme.of(context).colorScheme.surfaceContainerLowest,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const CircularProgressIndicator(),
              const SizedBox(height: 16),
              Text(AppLocalizations.of(context)!.fetchingLocation),
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
                _locationError ?? AppLocalizations.of(context)!.locationUnavailable,
                textAlign: TextAlign.center,
                style: GoogleFonts.dmSans(fontSize: 14),
              ),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: _initLocation,
                icon: const Icon(Icons.refresh_rounded),
                label: Text(AppLocalizations.of(context)!.retry),
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
          if (_buildHeatmapLayer() != null) _buildHeatmapLayer()!,
        ],
      );
    }

    return FutureBuilder<List<ll.LatLng>>(
      future: _routeFuture ??
          Future.value(<ll.LatLng>[_currentLocation!, _destination!.point]),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        final routePoints = snapshot.data ?? [];
        if (routePoints.isEmpty) {
          return const Center(child: Text('Failed to load route'));
        }

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
            if (_buildHeatmapLayer() != null) _buildHeatmapLayer()!,
            PolylineLayer(
              polylines: [
                Polyline(
                  points: routePoints,
                  strokeWidth: 5.0,
                  color: TruxifyColors.accent,
                  borderStrokeWidth: 2.0,
                  borderColor: Colors.white.withValues(alpha: 0.8),
                ),
              ],
            ),
            MarkerLayer(
              markers: _getMarkers(checkpoints),
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
            color: Colors.black.withValues(alpha: 0.06),
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
                                    AppLocalizations.of(context)!.fetchingLocation,
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
                                            AppLocalizations.of(context)!.tapToRefresh,
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
                        _destination?.address ?? AppLocalizations.of(context)!.whereAreYouHeading,
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
            color: Colors.black.withValues(alpha: 0.06),
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
                          color: (_isOnline ? TruxifyColors.success : TruxifyColors.secondaryText).withValues(alpha: 0.4),
                          blurRadius: 6,
                          spreadRadius: 2,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    _isOnline ? AppLocalizations.of(context)!.onlineAndReady : AppLocalizations.of(context)!.offline,
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
                activeThumbColor: TruxifyColors.success,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            !_isOnline
                ? AppLocalizations.of(context)!.offlineGoOnline
                : _isLoadingLocation
                    ? AppLocalizations.of(context)!.radarActiveFetching
                    : '${AppLocalizations.of(context)!.radarActiveLooking} ${_currentLocationLabel(context)}...',
            style: GoogleFonts.dmSans(
              fontSize: 11,
              color: TruxifyColors.adaptiveSecondaryText(context),
            ),
          ),
          const SizedBox(height: 16),
          if (_isLoadingMetrics)
            const SummaryCardsShimmer()
          else if (_metricsError != null)
            _buildErrorMetrics()
          else
            _buildMetricsRow(),
        ],
      ),
    );
  }

  Widget _buildMetricsRow() {
    final payValue = _todayEarnings != null
        ? '₹${_todayEarnings!.amount.toStringAsFixed(0)}'
        : '—';
    final hoursValue = _todayEarnings != null
        ? '${_todayEarnings!.hoursDriven.toStringAsFixed(1)} hrs'
        : '—';
    final ratingValue = _driverRating != null
        ? _driverRating!.toStringAsFixed(2)
        : '—';

    return Row(
      children: [
        Expanded(
          child: _buildShiftMetric(
            icon: Icons.account_balance_wallet_outlined,
            value: payValue,
            label: AppLocalizations.of(context)!.todayPay,
            labelKey: const Key('today_pay_label'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _buildShiftMetric(
            icon: Icons.timer_outlined,
            value: hoursValue,
            label: AppLocalizations.of(context)!.shiftHours,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _buildShiftMetric(
            icon: Icons.star_border_rounded,
            value: ratingValue,
            label: AppLocalizations.of(context)!.rating,
          ),
        ),
      ],
    );
  }

  Widget _buildErrorMetrics() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark
            ? Theme.of(context).colorScheme.surfaceContainerHighest
            : TruxifyColors.background,
        border: Border.all(color: TruxifyColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline_rounded,
              size: 14, color: TruxifyColors.errorRed),
          const SizedBox(width: 6),
          Text(
            AppLocalizations.of(context)!.metricsUnavailable,
            style: GoogleFonts.dmSans(
              fontSize: 11,
              color: TruxifyColors.errorRed,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildShiftMetric(
      {required IconData icon,
      required String value,
      required String label,
      Key? labelKey}) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark
            ? Theme.of(context).colorScheme.surfaceContainerHighest
            : TruxifyColors.background,
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
            key: labelKey,
            style: GoogleFonts.dmSans(
              fontSize: 9,
              color: TruxifyColors.adaptiveSecondaryText(context),
            ),
          ),
        ],
      ),
    );
  }

  Widget? _buildHeatmapLayer() {
    if (_heatmapData == null) return null;
    final features = _heatmapData!['features'] as List?;
    if (features == null || features.isEmpty) return null;

    final circles = <CircleMarker>[];
    for (final feature in features) {
      try {
        final geom = feature['geometry'];
        final coords = geom['coordinates'] as List;
        final props = feature['properties'] ?? {};
        final intensity = (props['intensity'] as num?)?.toDouble() ?? 0.5;

        circles.add(CircleMarker(
          point: ll.LatLng(coords[1], coords[0]),
          color: Colors.red.withValues(alpha: (intensity * 0.5).clamp(0.1, 0.5)),
          borderStrokeWidth: 0,
          useRadiusInMeter: true,
          radius: 2000,
        ));
      } catch (e) {
        // Ignore invalid features
      }
    }

    if (circles.isEmpty) return null;

    return CircleLayer(circles: circles);
  }

  Future<void> _openGoogleMapsRoute() async {
    if (_destination == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context)!.noDestinationAvailable)),
      );
      return;
    }

    if (_currentLocation == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(AppLocalizations.of(context)!.currentLocationUnavailable)),
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
          SnackBar(content: Text(AppLocalizations.of(context)!.unableToOpenGoogleMaps)),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(AppLocalizations.of(context)!.failedToGenerateRoute)),
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
            color: Colors.black.withValues(alpha: 0.08),
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
                      ? TruxifyColors.successLight
                      : TruxifyColors.accentLight,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  _isTripStarted ? AppLocalizations.of(context)!.enRoute : AppLocalizations.of(context)!.assignedLoad,
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
                  _activeTruckLabel,
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
            '${_currentLocationLabel(context)} → $routeStr',
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
              _buildTripSpec(AppLocalizations.of(context)!.distance, _activeTripDistance.isNotEmpty ? _activeTripDistance : '--'),
              _buildTripSpec(AppLocalizations.of(context)!.estDuration, _activeTripDuration.isNotEmpty ? _activeTripDuration : '--'),
              _buildTripSpec(AppLocalizations.of(context)!.estPayout, _activeTripPayout.isNotEmpty ? _activeTripPayout : '--'),
            ],
          ),
          const SizedBox(height: 16),
          if (_isTripStarted) ...[
            SlideToConfirmButton(
              label: AppLocalizations.of(context)!.slideToCompleteTrip,
              backgroundColor: TruxifyColors.success,
              onConfirmed: () async {
              await _completeRide();
              },
            ),
          ] else ...[
            SlideToConfirmButton(
              label: AppLocalizations.of(context)!.slideToStartTrip,
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
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(AppLocalizations.of(context)!.failedToStartTrip)),
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
                    AppLocalizations.of(context)!.cancelAssignment,
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

