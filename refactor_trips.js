const fs = require('fs');

const screenPath = 'apps/driver/lib/screens/trips_screen.dart';
let screenCode = fs.readFileSync(screenPath, 'utf8');

// 1. Create the controller file
const controllerCode = `import 'dart:async';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../core/supabase_config.dart';
import '../models/app_models.dart';
import '../models/marketplace_models.dart';
import '../services/marketplace_repository.dart';
import '../services/trip_cache.dart';
import '../services/trip_service.dart';

class TripsController extends ChangeNotifier {
  int selectedChipIndex = 0; 
  int selectedSortIndex = 0; 
  int topTabIndex = 0; 

  RealtimeChannel? _bidChannel;
  final MarketplaceRepository _marketplaceRepository = MarketplaceRepository();
  late final TripService _tripService;

  List<Map<String, dynamic>> trips = [];
  Map<String, List<Map<String, dynamic>>> tripStopsByTripId = {};
  Map<String, List<Map<String, dynamic>>> routePointsByTripId = {};

  bool isLoadingTrips = true;
  bool isLoadingMoreTrips = false;

  String? tripsError;
  String? nextTripsCursor;
  bool hasMoreTrips = true;
  bool isOfflineTripsData = false;
  DateTime? offlineTripsSavedAt;

  bool marketplaceLoading = false;
  String? marketplaceError;
  List<LoadOffer> marketplaceLoads = const [];
  List<LoadOffer> enRouteLoads = const [];
  Map<String, DriverBid> bidsByLoadId = const {};

  TripsController() {
    _tripService = TripService();
    loadTrips();
    if (SupabaseConfig.isConfigured) {
      refreshMarketplace();
      subscribeToRealtime();
    } else {
      marketplaceError = 'Supabase is not configured. Pass --dart-define=SUPABASE_URL=... and --dart-define=SUPABASE_ANON_KEY=...';
    }
  }

  void setTopTabIndex(int idx) {
    topTabIndex = idx;
    notifyListeners();
  }

  void setSelectedChipIndex(int idx) {
    selectedChipIndex = idx;
    notifyListeners();
  }

  void setSelectedSortIndex(int idx) {
    selectedSortIndex = idx;
    notifyListeners();
  }

  Future<void> loadTrips() async {
    isLoadingTrips = true;
    tripsError = null;
    nextTripsCursor = null;
    hasMoreTrips = true;
    notifyListeners();

    try {
      final result = await _tripService.fetchTripHistory(limit: 20);
      final fetchedTrips = result['trips'] as List<Map<String, dynamic>>;

      final stopsByTrip = <String, List<Map<String, dynamic>>>{};
      final routePointsByTrip = <String, List<Map<String, dynamic>>>{};

      await Future.wait(fetchedTrips.map((trip) async {
        final tripId = trip['trip_display_id']?.toString();
        if (tripId == null || tripId.isEmpty) return;

        final results = await Future.wait([
          _tripService.fetchTripStops(tripId),
          _tripService.fetchRouteMapPoints(tripId),
        ]);
        stopsByTrip[tripId] = results[0];
        routePointsByTrip[tripId] = results[1];
      }));

      trips = fetchedTrips;
      tripStopsByTripId = stopsByTrip;
      routePointsByTripId = routePointsByTrip;
      nextTripsCursor = result['nextCursor'] as String?;
      hasMoreTrips = result['hasMore'] as bool? ?? false;
      isLoadingTrips = false;
      isOfflineTripsData = false;
      offlineTripsSavedAt = null;
      notifyListeners();

      unawaited(TripCache.save(
        trips: fetchedTrips,
        stopsByTripId: stopsByTrip,
        routePointsByTripId: routePointsByTrip,
      ));
    } catch (e) {
      debugPrint('Failed to load trips: $e');

      final cached = await TripCache.load();
      if (cached != null && cached.trips.isNotEmpty) {
        trips = cached.trips;
        tripStopsByTripId = cached.stopsByTripId;
        routePointsByTripId = cached.routePointsByTripId;
        hasMoreTrips = false;
        isLoadingTrips = false;
        tripsError = null;
        isOfflineTripsData = true;
        offlineTripsSavedAt = cached.savedAt;
        notifyListeners();
        return;
      }

      isLoadingTrips = false;
      tripsError = e.toString();
      isOfflineTripsData = false;
      notifyListeners();
    }
  }

  Future<void> loadMoreTrips() async {
    if (isLoadingMoreTrips || !hasMoreTrips || isLoadingTrips) return;
    
    isLoadingMoreTrips = true;
    notifyListeners();

    try {
      final result = await _tripService.fetchTripHistory(
        cursor: nextTripsCursor,
        limit: 20,
      );
      final newTrips = result['trips'] as List<Map<String, dynamic>>;

      final stopsByTrip = <String, List<Map<String, dynamic>>>{};
      final routePointsByTrip = <String, List<Map<String, dynamic>>>{};

      await Future.wait(newTrips.map((trip) async {
        final tripId = trip['trip_display_id']?.toString();
        if (tripId == null || tripId.isEmpty) return;

        final results = await Future.wait([
          _tripService.fetchTripStops(tripId),
          _tripService.fetchRouteMapPoints(tripId),
        ]);
        stopsByTrip[tripId] = results[0];
        routePointsByTrip[tripId] = results[1];
      }));

      trips.addAll(newTrips);
      tripStopsByTripId.addAll(stopsByTrip);
      routePointsByTripId.addAll(routePointsByTrip);
      nextTripsCursor = result['nextCursor'] as String?;
      hasMoreTrips = result['hasMore'] as bool? ?? false;
      isLoadingMoreTrips = false;
      notifyListeners();
    } catch (e) {
      debugPrint('Failed to load more trips: $e');
      isLoadingMoreTrips = false;
      notifyListeners();
    }
  }

  TripStatusType getStatusType(String status) {
    switch (status.toLowerCase()) {
      case 'active':
      case 'in_progress':
      case 'en_route':
      case 'arrived':
        return TripStatusType.active;
      case 'completed':
        return TripStatusType.completed;
      case 'cancelled':
      default:
        return TripStatusType.cancelled;
    }
  }

  TripStatusType getStatusTypeFromIndex(int index) {
    switch (index) {
      case 1:
        return TripStatusType.active;
      case 2:
        return TripStatusType.completed;
      case 3:
      default:
        return TripStatusType.cancelled;
    }
  }

  int parseEarnings(String earnings) {
    final clean = earnings.replaceAll(RegExp(r'[^\\d]'), '');
    return int.tryParse(clean) ?? 0;
  }

  int totalEarningsPaise() => trips.fold(
        0,
        (sum, row) => sum + ((row['net_earnings'] ?? 0) as num).toInt(),
      );

  int completedCount() =>
      trips.where((r) => r['status'] == 'completed').length;

  double completionRate() {
    final total = trips.length;
    if (total == 0) return 0;
    return (completedCount() / total) * 100;
  }

  String formatEarnings(int paise) {
    final rupees = paise / 100;
    if (rupees >= 100000) {
      return '₹\${(rupees / 100000).toStringAsFixed(1)}L';
    } else if (rupees >= 1000) {
      return '₹\${(rupees / 1000).toStringAsFixed(1)}K';
    }
    return '₹\${rupees.toStringAsFixed(0)}';
  }

  Future<void> refreshMarketplace({bool showSpinner = true}) async {
    if (!SupabaseConfig.isConfigured) {
      marketplaceLoading = false;
      marketplaceError = 'Supabase is not configured. Pass --dart-define=SUPABASE_URL=... and --dart-define=SUPABASE_ANON_KEY=...';
      notifyListeners();
      return;
    }
    
    if (showSpinner) {
      marketplaceLoading = true;
      marketplaceError = null;
      notifyListeners();
    } else {
      marketplaceError = null;
      notifyListeners();
    }

    try {
      final results = await Future.wait([
        _marketplaceRepository.fetchLoadOffers(),
        _marketplaceRepository.fetchEnRouteLoads(),
        _marketplaceRepository.fetchDriverBids(),
      ]);

      final standardLoads = results[0] as List<LoadOffer>;
      final enRLoads = results[1] as List<LoadOffer>;
      final bids = results[2] as List<DriverBid>;
      final bidsByLoad = <String, DriverBid>{
        for (final bid in bids) bid.loadId: bid,
      };

      marketplaceLoads = standardLoads;
      enRouteLoads = enRLoads;
      bidsByLoadId = bidsByLoad;
      marketplaceLoading = false;
      notifyListeners();
    } catch (e) {
      marketplaceError = e.toString();
      marketplaceLoading = false;
      notifyListeners();
    }
  }

  void subscribeToRealtime() {
    _bidChannel = Supabase.instance.client
        .channel('driver-bids')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'load_bids',
          callback: (_) => refreshMarketplace(),
        )
        .subscribe();
  }

  @override
  void dispose() {
    if (SupabaseConfig.isConfigured && _bidChannel != null) {
      Supabase.instance.client.removeChannel(_bidChannel!);
    }
    super.dispose();
  }
}
`;

fs.writeFileSync('apps/driver/lib/controllers/trips_controller.dart', controllerCode);

// 2. We will just use node regex to rewrite trips_screen.dart to use the controller.
// Since it's a huge file, a naive regex is dangerous. 
// A better way is: Replace all `_trips` with `ctrl.trips`, `_isLoadingTrips` with `ctrl.isLoadingTrips`, etc.
// But first, we need to inject the controller and ListenableBuilder.

// Let's replace the top of the state class.
let topRegex = /class _TripsScreenState extends State<TripsScreen> \{[\s\S]*?final List<String> _statusFilters/;

let newTop = `import '../controllers/trips_controller.dart';\n\nclass _TripsScreenState extends State<TripsScreen> {
  final TripsController ctrl = TripsController();
  final ScrollController _scrollController = ScrollController();

  final List<String> _statusFilters`;

screenCode = screenCode.replace(topRegex, newTop);

// Now replace initState
let initRegex = /@override\s*void initState\(\) \{[\s\S]*?\}\s*Future<void> _loadTrips/m;
let newInit = `@override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  void _onScroll() {
    if (_scrollController.position.pixels >= _scrollController.position.maxScrollExtent - 200) {
      ctrl.loadMoreTrips();
    }
  }

  Future<void> _loadTrips`;

screenCode = screenCode.replace(initRegex, newInit);

// Now delete _loadTrips down to dispose() inclusive
let methodsRegex = /Future<void> _loadTrips\(\) async \{[\s\S]*?@override\s*void dispose\(\) \{[\s\S]*?super\.dispose\(\);\s*\}/m;
let newMethods = `@override
  void dispose() {
    _scrollController.dispose();
    ctrl.dispose();
    super.dispose();
  }`;
screenCode = screenCode.replace(methodsRegex, newMethods);

// Now we need to wrap the build method.
let buildRegex = /Widget build\(BuildContext context\) \{([\s\S]*?final colorScheme = Theme\.of\(context\)\.colorScheme;)/;
let newBuild = `Widget build(BuildContext context) {
    return ListenableBuilder(
  '_tripsError': 'ctrl.tripsError',
  '_hasMoreTrips': 'ctrl.hasMoreTrips',
  '_isOfflineTripsData': 'ctrl.isOfflineTripsData',
  '_offlineTripsSavedAt': 'ctrl.offlineTripsSavedAt',
  '_marketplaceLoading': 'ctrl.marketplaceLoading',
  '_marketplaceError': 'ctrl.marketplaceError',
  '_marketplaceLoads': 'ctrl.marketplaceLoads',
  '_enRouteLoads': 'ctrl.enRouteLoads',
  '_bidsByLoadId': 'ctrl.bidsByLoadId',
  '_trips': 'ctrl.trips',
  '_isLoadingTrips': 'ctrl.isLoadingTrips',
  '_isLoadingMoreTrips': 'ctrl.isLoadingMoreTrips',
  '_tripStopsByTripId': 'ctrl.tripStopsByTripId',
  '_routePointsByTripId': 'ctrl.routePointsByTripId',
  '_getStatusTypeFromIndex': 'ctrl.getStatusTypeFromIndex',
  '_getStatusType': 'ctrl.getStatusType',
  '_parseEarnings': 'ctrl.parseEarnings',
  '_totalEarningsPaise': 'ctrl.totalEarningsPaise',
  '_completedCount': 'ctrl.completedCount',
  '_completionRate': 'ctrl.completionRate',
  '_formatEarnings': 'ctrl.formatEarnings',
  '_refreshMarketplace': 'ctrl.refreshMarketplace',
  '_loadMoreTrips': 'ctrl.loadMoreTrips',
  '_loadTrips': 'ctrl.loadTrips',
};

// Also replace setState(() => _selectedSortIndex = tempSortIndex);
screenCode = screenCode.replace(/setState\(\(\) => _selectedSortIndex = (.*?)\);/g, 'ctrl.setSelectedSortIndex($1);');
screenCode = screenCode.replace(/setState\(\(\) => _selectedChipIndex = (.*?)\);/g, 'ctrl.setSelectedChipIndex($1);');
screenCode = screenCode.replace(/setState\(\(\) \{\s*_topTabIndex = (.*?);\s*\}\);/g, 'ctrl.setTopTabIndex($1);');


for (const [key, value] of Object.entries(replacements)) {
  const regex = new RegExp(key, 'g');
  screenCode = screenCode.replace(regex, value);
}

// Write the refactored code back
fs.writeFileSync('apps/driver/lib/screens/trips_screen.refactored.dart', screenCode);
console.log("Refactored file generated successfully.");
