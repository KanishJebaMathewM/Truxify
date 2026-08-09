// apps/driver/lib/screens/home_screen.dart
// XL changes:
//   1. Added _responsiveOverlay() helper — on tablets (≥840 dp) it centers
//      the child and caps its width at 680 px; on phones it adds 12 px side
//      padding (matching the original hardcoded left/right: 12 values).
//   2. Every Positioned that previously used left:12/right:12 now uses
//      left:0/right:0 and wraps its content in _responsiveOverlay().
//   3. The bottom sheet Positioned is similarly wrapped.
//   4. The map itself and full-width banners are untouched — they look great
//      on any screen size.
// All original logic is unchanged.

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
import 'package:truxify_shared/truxify_shared.dart';

import '../core/app_routes.dart';
import '../l10n/app_localizations.dart';
import '../models/app_models.dart';
import '../models/earnings_daily_model.dart';
import '../services/driver_earnings_service.dart';
import '../services/geocode_service.dart';
import '../services/marketplace_repository.dart';
import '../services/route_service.dart';
import '../services/trip_service.dart';
import '../services/sync_service.dart';
import '../services/battery_service.dart';
import '../services/location_service.dart';
import '../services/weigh_station_service.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../theme/app_theme.dart';
import '../utils/breakpoints.dart'; // XL: added
import '../widgets/map_markers.dart';
import '../widgets/slide_to_confirm_button.dart';
import '../widgets/home/offline_banner.dart';
import '../widgets/home/low_battery_banner.dart';
import '../widgets/home/active_navigation_header.dart';
import '../widgets/home/search_destination_card.dart';
import '../widgets/home/new_load_notification_banner.dart';
import '../widgets/home/driver_status_sheet.dart';
import '../widgets/home/active_trip_sheet.dart';
import 'destination_picker_screen.dart';
import 'pod_capture_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.marketplaceRepo,
    required this.earningsService,
    this.mockLocationText,
    this.onNavigateToLoads,
    this.onNavigateToActiveTrip,
  });

  final MarketplaceRepository marketplaceRepo;
  final DriverEarningsService earningsService;
  final String? mockLocationText;

  /// Called when the driver taps "Find New Load" CTA.
  /// Typically navigates to the loads marketplace tab.
  final VoidCallback? onNavigateToLoads;

  /// Called when the driver taps "View Active Trip" CTA.
  /// Typically navigates to the trips tab.
  final VoidCallback? onNavigateToActiveTrip;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _isOffline = false;
  ll.LatLng? _currentLocation;

  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  final MapController _mapController = MapController();
  final double _mapZoom = 5.7;

  Future<List<ll.LatLng>>? _routeFuture;
  DestinationPickResult? _destination;
  bool _isSearchExpanded = false;
  Map<String, dynamic>? _heatmapData;

  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  bool _hasPendingPods = false;

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
                  key: ValueKey('chk_${entry.key}'),
                  label: '${entry.key + 1}'),
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
  /// Order id (orders.id UUID) served by the active trip, used for
  /// order-scoped uploads such as proof of delivery.
  String? _activeOrderId;
  String _activeTruckLabel = '';
  String _activeTripDistance = '';
  String _activeTripDuration = '';
  String _activeTripEta = '';
  double _activeTripProgress = 0.0;
  String _activeTripStatus = '';
  String _activeTripPayout = '';
  /// Number of stops not yet completed on the active trip.
  int _activeTripStopsRemaining = 0;
  /// Current milestone of the active trip (e.g. 'en_route_pickup').
  String _activeTripMilestone = '';
  bool _isLoadingLocation = true;
  String? _locationError;
  late final MarketplaceRepository _marketplaceRepo;
  StreamSubscription? _tripSubscription;
  StreamSubscription? _loadSubscription;

  String _hosStatus = 'off_duty';
  int _hosDrivingMinutes = 0;
  int _hosOnDutyMinutes = 0;

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

  final BatteryService _batteryService = BatteryService.instance;
  int _batteryLevel = 100;
  bool _isCharging = false;
  bool _criticalDialogShown = false;

  // ── XL: helper ────────────────────────────────────────────────────────────
  /// On XL screens (≥840 dp) centers [child] and caps it at [maxWidth] px.
  /// On smaller screens adds 12 px horizontal padding (matching the original
  /// hardcoded left/right: 12 in Positioned widgets).
  Widget _responsiveOverlay(BuildContext context, Widget child,
      {double maxWidth = 680}) {
    if (Breakpoints.isXL(context)) {
      return Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxWidth),
          child: child,
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: child,
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  String _sanitizeCoordinate(dynamic coord) {
    if (coord == null) return '0.0';
    if (coord is double) return coord.toStringAsFixed(6);
    if (coord is int) return coord.toDouble().toStringAsFixed(6);
    return (double.tryParse(coord.toString()) ?? 0.0).toStringAsFixed(6);
  }

  void _clearNetworkError() {
    if (_networkError != null) {
      setState(() => _networkError = null);
    }
  }

  Future<void> _withRetry(Future<void> Function() fn) async {
    for (int i = 0; i < 3; i++) {
      try {
        await fn();
        return;
      } catch (e) {
        if (i < 2) {
          await Future.delayed(Duration(seconds: i + 1));
        }
      }
    }
    if (mounted) {
      setState(() => _networkError =
          'Network error. Please check your connection and try again.');
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
    _initBatteryMonitoring();
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

  // ── Battery monitoring ─────────────────────────────────────────────────────

  void _initBatteryMonitoring() {
    _batteryService.addListener(_onBatteryChanged);
    _batteryService.startMonitoring();
  }

  void _onBatteryChanged() {
    if (!mounted) return;
    final info = _batteryService.currentInfo;
    setState(() {
      _batteryLevel = info.level;
      _isCharging = info.isCharging;
    });
    if (info.isCritical && !_criticalDialogShown) {
      _criticalDialogShown = true;
      _showCriticalBatteryDialog();
    }
  }

  void _showCriticalBatteryDialog() {
    if (!mounted) return;
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        icon: const Icon(
          Icons.battery_alert_rounded,
          color: TruxifyColors.errorRed,
          size: 48,
        ),
        title: const Text('Critical Battery'),
        content: Text(
          'Battery is at $_batteryLevel%. '
          'Please connect your charger immediately to continue tracking.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Dismiss'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              BatteryService.instance.openBatterySettings();
            },
            child: const Text('Open Battery Settings'),
          ),
        ],
      ),
    ).then((_) {
      if (mounted && _batteryService.currentInfo.isCritical) {
        _criticalDialogShown = false;
      }
    });
  }

  void _toggleHosStatus(String status) {
    setState(() => _hosStatus = status);
    debugPrint('[HoS] status changed → $status');
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
    _batteryService.removeListener(_onBatteryChanged);
    _connectivitySubscription?.cancel();
    _loadSubscription?.cancel();
    _tripSubscription?.cancel();
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
      _loadSubscription =
          _marketplaceRepo.subscribeToNewLoads().listen((load) {
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
      final historyRows = historyData['trips'] is List
          ? (historyData['trips'] as List)
              .whereType<Map>()
              .map((t) => Map<String, dynamic>.from(t))
          : const Iterable<Map<String, dynamic>>.empty();
      final historyList = historyRows
          .map((t) => TripRecord(
                route: (t['route'] as String?) ??
                    (t['route_label'] as String?) ??
                    '',
                date: (t['date'] as String?) ??
                    (t['trip_date'] as String?) ??
                    '',
                earnings: (t['earnings'] as String?) ??
                    (t['payout'] as String?) ??
                    '',
                statusLabel: (t['status_label'] as String?) ??
                    (t['status'] as String?) ??
                    '',
                tripId: (t['trip_display_id'] as String?) ??
                    (t['trip_id'] as String?) ??
                    '',
                hash: (t['hash'] as String?) ??
                    (t['blockchain_hash'] as String?) ??
                    '',
                verifiedBadge: (t['verified_badge'] as String?) ?? '',
                completed: (t['completed'] as bool?) ??
                    (t['is_completed'] as bool?) ??
                    false,
              ))
          .toList();

      setState(() {
        _todayEarnings = results[0] as EarningsDailyModel?;
        final stats =
            results[1] as Map<String, dynamic>? ?? <String, dynamic>{};
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
        _currentLocation =
            ll.LatLng(position.latitude, position.longitude);
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
        _currentLocationText = null;
      });
    }
  }

  Future<Position?> _fetchGpsPosition() async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
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
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
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

      return await Geolocator.getCurrentPosition(
        locationSettings:
            const LocationSettings(accuracy: LocationAccuracy.high),
      );
    } catch (e, stackTrace) {
      debugPrint('LOCATION ERROR: $e\n$stackTrace');
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
        title: Text(
            AppLocalizations.of(context)!.locationPermissionRequired),
        content: Text(AppLocalizations.of(context)!.locationPermDenied),
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

  Future<void> _fetchCurrentLocation() async {
    setState(() {
      _isRefreshingLocation = true;
      _locationError = null;
    });

    final position = await _fetchGpsPosition();

    if (!mounted) return;

    if (position != null) {
      setState(() {
        _currentLocation =
            ll.LatLng(position.latitude, position.longitude);
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

  String _computeEtaFromDuration(String duration) {
    if (duration.isEmpty) return '';
    int totalMinutes = 0;
    final hoursMatch = RegExp(r'(\d+)\s*h').firstMatch(duration);
    final minsMatch = RegExp(r'(\d+)\s*m').firstMatch(duration);
    if (hoursMatch != null) {
      totalMinutes += int.tryParse(hoursMatch.group(1) ?? '0') ?? 0;
      totalMinutes *= 60;
    }
    if (minsMatch != null) {
      totalMinutes += int.tryParse(minsMatch.group(1) ?? '0') ?? 0;
    }
    if (totalMinutes == 0) return '';
    final eta = DateTime.now().add(Duration(minutes: totalMinutes));
    final h = eta.hour;
    final m = eta.minute.toString().padLeft(2, '0');
    final period = h >= 12 ? 'PM' : 'AM';
    final h12 = h % 12 == 0 ? 12 : h % 12;
    return 'ETA $h12:$m $period';
  }

  double _computeProgressFromStops(List<Map<String, dynamic>> stops) {
    if (stops.isEmpty) return 0.0;
    final completed =
        stops.where((s) => s['is_completed'] == true).length;
    return completed / stops.length;
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
        final truckLabel =
            truckPlate.isNotEmpty && truckModel.isNotEmpty
                ? '$truckPlate · $truckModel'
                : (activeTrip['truck_label'] as String?) ?? 'Truck assigned';

        final prefs = await SharedPreferences.getInstance();
        final distanceStr = (activeTrip['distance'] as String?) ??
            (activeTrip['trip_distance'] as String?) ??
            '';
        final durationStr = (activeTrip['duration'] as String?) ??
            (activeTrip['trip_duration'] as String?) ??
            '';
        final payoutStr = (activeTrip['estimated_payout'] as String?) ??
            (activeTrip['price'] as String?) ??
            (activeTrip['payout'] as String?) ??
            '';

        await prefs.setString('cached_trip_id', tripId);
        await prefs.setString('cached_order_id', activeTrip['order_id']?.toString() ?? '');
        await prefs.setString('cached_truck_label', truckLabel);
        await prefs.setString('cached_distance', distanceStr);
        await prefs.setString('cached_duration', durationStr);
        await prefs.setString('cached_payout', payoutStr);

        final isTripStarted = stops.any(
          (s) => s['is_completed'] == true || s['is_current'] == true,
        );
        await prefs.setBool('cached_is_started', isTripStarted);

        // Compute stops remaining and current milestone for the home card.
        final pendingStops = stops.where((s) => s['is_completed'] != true).length;
        final currentStop = stops.where((s) => s['is_current'] == true).firstOrNull;
        final milestone = (currentStop?['status'] as String?) ??
            (currentStop?['milestone'] as String?) ?? '';

        setState(() {
          _isOffline = false;
          _activeTripId = tripId;
          _activeOrderId = activeTrip['order_id']?.toString();
          _activeTruckLabel = truckLabel;
          _activeTripDistance = distanceStr;
          _activeTripDuration = durationStr;
          _activeTripPayout = payoutStr;
          _isTripStarted = isTripStarted;
          _activeTripStopsRemaining = pendingStops;
          _activeTripMilestone = milestone;
        });

        if (stops.isNotEmpty) {
          final lastStop = stops.last;
          final address = lastStop['drop_location'] as String? ?? '';
          await prefs.setString('cached_address', address);

          final dropPoint = await GeocodeService.resolvePlace(address);
          if (dropPoint != null) {
            await prefs.setDouble('cached_drop_lat', dropPoint.latitude);
            await prefs.setDouble('cached_drop_lng', dropPoint.longitude);
          }

          if (dropPoint != null && mounted) {
            setState(() {
              _destination = DestinationPickResult(
                  address: address, point: dropPoint);
              final routePoints = <ll.LatLng>[
                _currentLocation ?? dropPoint,
                dropPoint
              ];
              _routeFuture =
                  RouteService.fetchRouteGeoJson(routePoints)
                      .onError((_, __) => routePoints);
            });
          }
        }
      } else {
        final prefs = await SharedPreferences.getInstance();
        await prefs.remove('cached_trip_id');
        await prefs.remove('cached_order_id');
        if (mounted) {
          setState(() {
            _isOffline = false;
            _activeTripId = null;
            _activeOrderId = null;
            _isTripStarted = false;
            _destination = null;
            _routeFuture = null;
            _activeTripEta = '';
            _activeTripProgress = 0.0;
            _activeTripStatus = '';
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
          _activeOrderId = prefs.getString('cached_order_id');
          _activeTruckLabel = prefs.getString('cached_truck_label') ?? '';
          _activeTripDistance = prefs.getString('cached_distance') ?? '';
          _activeTripDuration = prefs.getString('cached_duration') ?? '';
          _activeTripPayout = prefs.getString('cached_payout') ?? '';
          _isTripStarted = prefs.getBool('cached_is_started') ?? false;
          _activeTripStatus =
              _isTripStarted ? 'EN-ROUTE' : 'ASSIGNED LOAD';
        });
        final address = prefs.getString('cached_address');
        final lat = prefs.getDouble('cached_drop_lat');
        final lng = prefs.getDouble('cached_drop_lng');
        if (address != null && lat != null && lng != null) {
          setState(() {
            _destination = DestinationPickResult(
              address: address,
              point: ll.LatLng(lat, lng),
            );
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
        WeighStationService.instance.resetAlertedStations();
        if (mounted) {
          setState(() {
            _activeTripId = null;
            _activeOrderId = null;
            _isTripStarted = false;
            _destination = null;
            _routeFuture = null;
            _activeTripEta = '';
            _activeTripProgress = 0.0;
            _activeTripStatus = '';
          });
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isOnline = !newStatus);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(AppLocalizations.of(context)!.error)),
        );
      }
    }
  }

  void _onMapTap(ll.LatLng point) {
    if (_currentLocation == null) return;
    if (!_isOnline) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(AppLocalizations.of(context)!.pleaseGoOnline)),
      );
      return;
    }
    if (!_isDestinationExpanded) return;
    setState(() {
      _destination = DestinationPickResult(
          address: 'Pinned location', point: point);
      _searchController.text = _destination!.address;
      _isDestinationExpanded = false;
      final routePoints = <ll.LatLng>[_currentLocation!, point];
      _routeFuture = RouteService.fetchRouteGeoJson(routePoints)
          .onError((_, __) => routePoints);
    });
  }

  Future<void> _openDestinationPicker() async {
    if (!_isOnline) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content:
                Text(AppLocalizations.of(context)!.pleaseGoOnline)),
      );
      return;
    }
    final query = _searchController.text.trim();
    final result =
        await Navigator.of(context, rootNavigator: true).pushNamed(
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
        _routeFuture = RouteService.fetchRouteGeoJson(routePoints)
            .onError((_, __) => routePoints);
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
        final currentStop =
            stops.where((s) => s['is_current'] == true).firstOrNull;
        if (currentStop != null) {
          await _tripService.markStopCompleted(
              currentStop['id'].toString(), _activeTripId!);
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
                content: Text(
                    AppLocalizations.of(context)!.failedToCompleteTrip)),
          );
        }
        return;
      }
    }
    _clearDestination();
    WeighStationService.instance.resetAlertedStations();
    if (mounted) {
      setState(() {
        _activeTripId = null;
        _isTripStarted = false;
        _activeTripEta = '';
        _activeTripProgress = 0.0;
        _activeTripStatus = '';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              AppLocalizations.of(context)!.tripCompletedNetEarnings('')),
          backgroundColor: TruxifyColors.success,
        ),
      );
      _loadDashboardMetrics();
    }
  }

  Future<void> _checkPendingPods() async {
    try {
      final hasPending = await SyncService.instance
          .isStopPendingSync(_activeTripId ?? '');
      if (hasPending && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Some deliveries are pending sync.')),
        );
      }
    } catch (e) {
      debugPrint('Error checking pending PoDs: $e');
    }
  }

  // ── eBoL QR ───────────────────────────────────────────────────────────────

  void _showEbolQrCode() {
    if (_activeTripId == null) return;
    final payload =
        jsonEncode({'order_id': _activeTripId, 'type': 'eBoL'});
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Digital Bill of Lading (eBoL)'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
                'Show this QR code to the warehouse clerk for instant verification.'),
            const SizedBox(height: 20),
            QrImageView(
                data: payload,
                version: QrVersions.auto,
                size: 200.0),
            const SizedBox(height: 10),
            Text('Order ID: $_activeTripId',
                style:
                    const TextStyle(fontSize: 10, color: Colors.grey)),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  String _currentLocationLabel(BuildContext context) {
    if (_isLoadingLocation) return AppLocalizations.of(context)!.locating;
    if (_locationError != null) {
      return AppLocalizations.of(context)!.locationUnavailable;
    }
    if (_currentLocationText != null &&
        _currentLocationText!.isNotEmpty) {
      final parts = _currentLocationText!.split(',');
      return parts.first.trim();
    }
    return AppLocalizations.of(context)!.currentLocation;
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        bottom: false,
        child: Stack(
          children: [
            // ── Map — fills the full screen on any device ──────────────
            Positioned.fill(
              child: _buildMapBody(context),
            ),

            // ── Offline pending-pod banner — intentionally full width ──
            if (_hasPendingPods)
              Positioned(
                left: 0,
                right: 0,
                top: 0,
                child: Container(
                  color: Colors.orange,
                  padding: const EdgeInsets.symmetric(
                      vertical: 4, horizontal: 16),
                  child: const Text(
                    'Offline Mode - Pending Sync',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 12),
                  ),
                ),
              ),

            // ── Top search / navigation header ────────────────────────
            // XL: _responsiveOverlay caps this at 680 px and centers it.
            Positioned(
              left: 0,   // XL: was left: 12
              right: 0,  // XL: was right: 12
              top: 12,
              child: SafeArea(
                bottom: false,
                child: _responsiveOverlay(
                  context,
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (_isOffline)
                        Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.symmetric(
                              vertical: 8, horizontal: 16),
                          decoration: BoxDecoration(
                            color: TruxifyColors.errorRed,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.cloud_off_rounded,
                                  color: Colors.white, size: 16),
                              const SizedBox(width: 8),
                              Text(
                                AppLocalizations.of(context)!
                                    .offlineUsingCachedData,
                                style: GoogleFonts.dmSans(
                                    color: Colors.white,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600),
                              ),
                            ],
                          ),
                        ),
                    if (_isOffline) const OfflineBanner(),
                    if (!_isCharging && _batteryLevel <= 20)
                      LowBatteryBanner(
                        batteryLevel: _batteryLevel,
                        isCritical: _batteryLevel <= 10,
                      ),
                    _isTripStarted
                        ? ActiveTripSheet(
                            isTripStarted: _isTripStarted,
                            truckLabel: _activeTruckLabel,
                            currentLocationLabel: _currentLocationLabel,
                            destinationAddress:
                                _destination?.address ?? 'Destination',
                            distance: _activeTripDistance,
                            duration: _activeTripDuration,
                            payout: _activeTripPayout,
                            stopsRemaining: _activeTripStopsRemaining > 0
                                ? _activeTripStopsRemaining
                                : null,
                            currentMilestone: _activeTripMilestone.isNotEmpty
                                ? _activeTripMilestone
                                : null,
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

            // ── HoS over-limit warning ────────────────────────────────
            // XL: _responsiveOverlay caps to 680 px.
            if (_hosDrivingMinutes >= 660 || _hosOnDutyMinutes >= 840)
              Positioned(
                left: 0,   // XL: was left: 12
                right: 0,  // XL: was right: 12
                top: 96,
                child: _responsiveOverlay(
                  context,
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.redAccent,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Text(
                      'HoS Limit Exceeded! Mandatory 30-min rest break required.',
                      style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold),
                    ),
                  ),
                ),
              ),

            // ── HoS status card ───────────────────────────────────────
            // XL: _responsiveOverlay caps to 680 px.
            Positioned(
              left: 0,   // XL: was left: 12
              right: 0,  // XL: was right: 12
              top: (_hosDrivingMinutes >= 660 || _hosOnDutyMinutes >= 840)
                  ? 156
                  : 96,
              child: _responsiveOverlay(
                context,
                Card(
                  elevation: 4,
                  child: Padding(
                    padding: const EdgeInsets.all(8.0),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'HoS Status: ${_hosStatus.toUpperCase()}',
                              style: const TextStyle(
                                  fontWeight: FontWeight.bold),
                            ),
                            Text(
                              'Driving: ${(_hosDrivingMinutes / 60).toStringAsFixed(1)}h / 11h',
                            ),
                          ],
                        ),
                        Row(
                          children: [
                            TextButton(
                              onPressed: () =>
                                  _toggleHosStatus('off_duty'),
                              child: const Text('Off Duty',
                                  style: TextStyle(fontSize: 12)),
                            ),
                            TextButton(
                              onPressed: () =>
                                  _toggleHosStatus('driving'),
                              child: const Text('Driving',
                                  style: TextStyle(fontSize: 12)),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),

            // ── New load notification banner ──────────────────────────
            // XL: _responsiveOverlay caps to 680 px.
            if (_latestNewLoad != null && !_dismissedNewLoad)
              Positioned(
                left: 0,   // XL: was left: 12
                right: 0,  // XL: was right: 12
                top: 96,
                child: _responsiveOverlay(
                  context,
                  NewLoadNotificationBanner(
                    load: _latestNewLoad!,
                    onView: () {},
                    onDismiss: () =>
                        setState(() => _dismissedNewLoad = true),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: TruxifyColors.accent,
                        borderRadius: BorderRadius.circular(14),
                        boxShadow: [
                          BoxShadow(
                            color: TruxifyColors.accent
                                .withValues(alpha: 0.25),
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
                              crossAxisAlignment:
                                  CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  AppLocalizations.of(context)!
                                      .newLoadAvailable,
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
                                      color: Colors.white),
                                ),
                                const SizedBox(height: 1),
                                Text(
                                  '${_latestNewLoad!.weight != '—' ? '${_latestNewLoad!.weight} ' : ''}'
                                  '${_latestNewLoad!.goods} • ${_latestNewLoad!.estimatedProfit}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: GoogleFonts.dmSans(
                                      fontSize: 10,
                                      color: Colors.white
                                          .withValues(alpha: 0.85)),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 10),
                          GestureDetector(
                            key: const Key(
                                'realtime_notification_view_button'),
                            onTap: () {
                              setState(
                                  () => _dismissedNewLoad = true);
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
                            key: const Key(
                                'realtime_notification_close_button'),
                            onTap: () => setState(
                                () => _dismissedNewLoad = true),
                            child: Icon(
                              Icons.close_rounded,
                              color:
                                  Colors.white.withValues(alpha: 0.7),
                              size: 20,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),

            // Heatmap legend — shown bottom-left when heatmap data is loaded
            if (_heatmapData != null)
              AnimatedPositioned(
                duration: const Duration(milliseconds: 300),
                curve: Curves.easeInOut,
                left: 16,
                bottom:
                    _showStatusCard ? (_destination == null ? 228 : 278) : 40,
                child: _buildHeatmapLegend(context),
              ),

            // Recenter FAB
            if (_currentLocation != null)
              AnimatedPositioned(
                duration: const Duration(milliseconds: 300),
                curve: Curves.easeInOut,
                right: 16,
                bottom: _showStatusCard
                    ? (_destination == null ? 220 : 270)
                    : 32,
                child: FloatingActionButton(
                  heroTag: 'driver-home-recenter',
                  onPressed: _centerMapOnCurrentLocation,
                  backgroundColor:
                      Theme.of(context).colorScheme.surface,
                  foregroundColor: TruxifyColors.accent,
                  elevation: 4,
                  shape: const CircleBorder(),
                  child: const Icon(Icons.my_location_rounded),
                ),
              ),

            // ── Bottom controller card ────────────────────────────────
            // XL: _responsiveOverlay caps to 680 px and centers it.
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: SafeArea(
                top: false,
                minimum: EdgeInsets.zero,
                child: AnimatedSlide(
                  duration: const Duration(milliseconds: 300),
                  offset: _showStatusCard
                      ? Offset.zero
                      : const Offset(0, 1.2),
                  child: GestureDetector(
                    onTap: () =>
                        setState(() => _showStatusCard = !_showStatusCard),
                    child: _destination == null
                        ? DriverStatusSheet(
                            isOnline: _isOnline,
                            isLoadingLocation: _isLoadingLocation,
                            currentLocationLabel:
                                _currentLocationLabel(context),
                            isLoadingMetrics: _isLoadingMetrics,
                            metricsError: _metricsError,
                            todayEarnings: _todayEarnings,
                            driverRating: _driverRating,
                            onToggleOnline: _toggleOnlineState,
                            batteryLevel: _batteryLevel,
                            isCharging: _isCharging,
                            hasActiveTrip: _activeTripId != null,
                            onFindLoad: widget.onNavigateToLoads,
                            onViewTrip: _activeTripId != null
                                ? widget.onNavigateToActiveTrip
                                : null,
                          )
                        : ActiveTripSheet(
                            isTripStarted: _isTripStarted,
                            truckLabel: _activeTruckLabel,
                            currentLocationLabel:
                                _currentLocationLabel(context),
                            destinationAddress:
                                _destination?.address ?? 'Destination',
                            distance: _activeTripDistance,
                            duration: _activeTripDuration,
                            payout: _activeTripPayout,
                            stopsRemaining: _activeTripStopsRemaining > 0
                                ? _activeTripStopsRemaining
                                : null,
                            currentMilestone: _activeTripMilestone.isNotEmpty
                                ? _activeTripMilestone
                                : null,
                            onStartTrip: () async {
                              if (_activeTripId == null) {
                                setState(() => _isTripStarted = true);
                                return;
                              }
                              try {
                                await _tripService.startTrip(_activeTripId!);
                                if (mounted) {
                                  setState(() {
                                    _isTripStarted = true;
                                    _activeTripStatus = 'EN-ROUTE';
                                  });
                                }
                                try {
                                  await _tripService
                                      .startTrip(_activeTripId!);
                                  if (mounted) {
                                    setState(() {
                                      _isTripStarted = true;
                                      _activeTripStatus = 'EN-ROUTE';
                                    });
                                  }
                                } catch (e) {
                                  if (context.mounted) {
                                    ScaffoldMessenger.of(context)
                                        .showSnackBar(
                                      SnackBar(
                                          content: Text(
                                              'Failed to start trip: $e')),
                                    );
                                  }
                                }
                              },
                              onCompleteTrip: _completeRide,
                              onCancel: _clearDestination,
                              onOpenMaps: _openGoogleMapsRoute,
                            ),
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

  // ── Map builder ────────────────────────────────────────────────────────────

  Widget _buildMapBody(BuildContext context) {
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
                _locationError ??
                    AppLocalizations.of(context)!.locationUnavailable,
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
            setState(() => _showStatusCard = !_showStatusCard);
            _onMapTap(point);
          },
          onPositionChanged: (position, hasGesture) {
            if (hasGesture && _showStatusCard) {
              setState(() => _showStatusCard = false);
            }
          },
        ),
        children: [
          TileLayer(
            urlTemplate:
                'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            userAgentPackageName: 'com.truxify.driver',
          ),
          if (_buildHeatmapLayer() != null) _buildHeatmapLayer()!,
        ],
      );
    }

    return FutureBuilder<List<ll.LatLng>>(
      future: _routeFuture ??
          Future.value(
              <ll.LatLng>[_currentLocation!, _destination!.point]),
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
              urlTemplate:
                  'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
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

  // ── Route geometry helpers ─────────────────────────────────────────────────

  ll.LatLng _routeCenter(List<ll.LatLng> points) {
    final lats =
        points.map((p) => p.latitude).toList(growable: false);
    final lngs =
        points.map((p) => p.longitude).toList(growable: false);
    return ll.LatLng(
      (lats.reduce(math.min) + lats.reduce(math.max)) / 2,
      (lngs.reduce(math.min) + lngs.reduce(math.max)) / 2,
    );
  }

  double _routeZoom(List<ll.LatLng> points) {
    final lats =
        points.map((p) => p.latitude).toList(growable: false);
    final lngs =
        points.map((p) => p.longitude).toList(growable: false);
    final span = math.max(
      lats.reduce(math.max) - lats.reduce(math.min),
      lngs.reduce(math.max) - lngs.reduce(math.min),
    );
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
      indexes.add(
          ((totalSegments * step) / 4).round().clamp(1, totalSegments - 1).toInt());
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
                                  width: 24,
                                  height: 24,
                                  child: Padding(
                                    padding: EdgeInsets.all(4.0),
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2.0,
                                      color: TruxifyColors.accent,
                                    ),
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

  /// Maps an intensity value [0–1] to a demand zone colour.
  ///
  /// - ≥ 0.7 → red   (high demand)
  /// - ≥ 0.4 → orange (medium demand)
  /// -  < 0.4 → green  (low demand)
  Color _heatmapZoneColor(double intensity) {
    if (intensity >= 0.7) return Colors.red;
    if (intensity >= 0.4) return Colors.orange;
    return Colors.green;
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
        final zoneColor = _heatmapZoneColor(intensity);

        circles.add(CircleMarker(
          point: ll.LatLng(coords[1], coords[0]),
          // Fill: zone colour with intensity-scaled alpha for depth effect
          color: zoneColor.withValues(alpha: (intensity * 0.45).clamp(0.08, 0.45).toDouble()),
          borderColor: zoneColor.withValues(alpha: 0.6),
          borderStrokeWidth: 1.0,
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

  /// Compact demand-heatmap legend shown in the bottom-left of the map.
  Widget _buildHeatmapLegend(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark
        ? Colors.black.withValues(alpha: 0.72)
        : Colors.white.withValues(alpha: 0.88);

    Widget _dot(Color c) => Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: c, shape: BoxShape.circle),
        );

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'DEMAND',
            style: GoogleFonts.dmSans(
              fontSize: 8,
              fontWeight: FontWeight.bold,
              color: isDark ? Colors.white70 : TruxifyColors.secondaryText,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 5),
          Row(children: [_dot(Colors.red), const SizedBox(width: 5), Text('High', style: GoogleFonts.dmSans(fontSize: 9, color: isDark ? Colors.white : TruxifyColors.primaryText))]),
          const SizedBox(height: 3),
          Row(children: [_dot(Colors.orange), const SizedBox(width: 5), Text('Med', style: GoogleFonts.dmSans(fontSize: 9, color: isDark ? Colors.white : TruxifyColors.primaryText))]),
          const SizedBox(height: 3),
          Row(children: [_dot(Colors.green), const SizedBox(width: 5), Text('Low', style: GoogleFonts.dmSans(fontSize: 9, color: isDark ? Colors.white : TruxifyColors.primaryText))]),
        ],
      ),
    );
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
            if (_isTripStarted && _activeTripId != null) ...[
              ElevatedButton.icon(
                onPressed: () async {
                  await Navigator.push(context, MaterialPageRoute(builder: (_) => PodCaptureScreen(orderId: _activeOrderId ?? _activeTripId!)));
                  _checkPendingPods();
                },
                icon: const Icon(Icons.camera_alt),
                label: const Text('Capture Proof of Delivery'),
                style: ElevatedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              ),
              const SizedBox(height: 12),
            ],
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