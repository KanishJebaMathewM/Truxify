
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
  final List<TripRecord> tripHistory = [];

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
        _earningsService.fetchTodayEarningsSummary().catchError((_) => null),
        _earningsService.fetchDriverStats().catchError((_) => <String, dynamic>{}),
        _tripService.fetchTripHistory(limit: 50).catchError((_) => <String, dynamic>{'trips': []}),
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
    _loadDashboardMetrics();
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

}

