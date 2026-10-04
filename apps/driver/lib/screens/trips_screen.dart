import 'dart:async';
import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';
import 'package:google_fonts/google_fonts.dart'; 
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' as ll;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_shared/truxify_shared.dart';
import 'package:truxify_shared/shimmer_widget.dart';
import '../core/app_routes.dart';
import '../core/driver_session.dart';
import '../core/supabase_config.dart';
import '../l10n/app_localizations.dart';
import '../models/app_models.dart';
import '../models/deadhead_recommendation.dart';
import '../models/marketplace_models.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import '../widgets/marketplace/deadhead_recommendation_card.dart';
import '../services/bid_submission_guard.dart';
import '../services/marketplace_repository.dart';
import '../services/trip_cache.dart';
import '../services/trip_service.dart';
import '../services/sync_service.dart';
import '../services/truck_repository.dart';
import 'pod_screen.dart';

class TripsScreen extends StatefulWidget {
  const TripsScreen({super.key});

  @override
  State<TripsScreen> createState() => _TripsScreenState();
}

class _TripsScreenState extends State<TripsScreen> {
  int _selectedChipIndex = 0; // 0: All, 1: Active, 2: Completed, 3: Cancelled
  int _selectedSortIndex =
      0; // 0: Newest, 1: Oldest, 2: Highest, 3: Lowest, 4: By status
  int _topTabIndex = 0; // 0: Trips, 1: Marketplace

  RealtimeChannel? _bidChannel;
  final MarketplaceRepository _marketplaceRepository = MarketplaceRepository();
  final BidSubmissionGuard _bidSubmissionGuard = BidSubmissionGuard();
  final TruckRepository _truckRepository = TruckRepository();
  late final TripService _tripService;

  List<Map<String, dynamic>> _trips = [];
  Map<String, List<Map<String, dynamic>>> _tripStopsByTripId = {};
  Map<String, List<Map<String, dynamic>>> _routePointsByTripId = {};
  Map<String, List<Map<String, dynamic>>> _itemsByTripId = {};

  bool _isLoadingTrips = true;
  bool _isLoadingMoreTrips = false;
  final ScrollController _scrollController = ScrollController();

  String? _tripsError;
  String? _nextTripsCursor;
  bool _hasMoreTrips = true;
  bool _isOfflineTripsData = false;
  DateTime? _offlineTripsSavedAt;

  bool _marketplaceLoading = false;
  String? _marketplaceError;
  List<LoadOffer> _marketplaceLoads = const [];
  List<LoadOffer> _enRouteLoads = const [];
  Map<String, DriverBid> _bidsByLoadId = const {};
  Set<String> _submittingLoadIds = const <String>{};

  bool _deadheadLoading = false;
  String? _deadheadError;
  List<DeadheadRecommendation> _deadheadRecommendations = const [];
  Map<String, DriverBid> _deadheadBidsByLoadId = const {};
  Set<String> _submittingDeadheadLoadIds = const <String>{};

  Truck? _truck;

  final List<String> _statusFilters = [
    'All',
    'Active',
    'Completed',
    'Cancelled',
  ];

  @override
  void initState() {
    super.initState();
    SyncService.instance.startListening();
    _tripService = TripService();
    _scrollController.addListener(_onScroll);
    _loadTrips();
    if (SupabaseConfig.isConfigured) {
      _refreshMarketplace();
      _subscribeToRealtime();
      _fetchDeadheadRecommendations();
    } else {
      _marketplaceError =
          'Supabase is not configured. Pass --dart-define=SUPABASE_URL=... and --dart-define=SUPABASE_ANON_KEY=...';
    }
  }

  Future<void> _loadTrips() async {
    setState(() {
      _isLoadingTrips = true;
      _tripsError = null;
      _nextTripsCursor = null;
      _hasMoreTrips = true;
    });

    try {
      final result = await _tripService.fetchTripHistory(limit: 20);
      final trips = result['trips'] as List<Map<String, dynamic>>;

      final stopsByTrip = <String, List<Map<String, dynamic>>>{};
      final routePointsByTrip = <String, List<Map<String, dynamic>>>{};
      final itemsByTrip = <String, List<Map<String, dynamic>>>{};

      await Future.wait(trips.map((trip) async {
        final tripId = trip['trip_display_id']?.toString();
        if (tripId == null || tripId.isEmpty) return;

        final results = await Future.wait([
          _tripService.fetchTripStops(tripId),
          _tripService.fetchRouteMapPoints(tripId),
          _tripService.fetchTripItems(tripId),
        ]);
        stopsByTrip[tripId] = results[0];
        routePointsByTrip[tripId] = results[1];
        itemsByTrip[tripId] = results[2];
      }));

      if (!mounted) return;

      setState(() {
        _trips = trips;
        _tripStopsByTripId = stopsByTrip;
        _routePointsByTripId = routePointsByTrip;
        _itemsByTripId = itemsByTrip;
        _nextTripsCursor = result['nextCursor'] as String?;
        _hasMoreTrips = result['hasMore'] as bool? ?? false;
        _isLoadingTrips = false;
        _isOfflineTripsData = false;
        _offlineTripsSavedAt = null;
      });

      unawaited(TripCache.save(
        trips: trips,
        stopsByTripId: stopsByTrip,
        routePointsByTripId: routePointsByTrip,
        itemsByTripId: itemsByTrip,
      ));
    } catch (e) {
      debugPrint('Failed to load trips: $e');
      if (!mounted) return;

      final cached = await TripCache.load();
      if (cached != null && cached.trips.isNotEmpty) {
        if (!mounted) return;
        setState(() {
          _trips = cached.trips;
          _tripStopsByTripId = cached.stopsByTripId;
          _routePointsByTripId = cached.routePointsByTripId;
          _itemsByTripId = cached.itemsByTripId;
          _hasMoreTrips = false;
          _isLoadingTrips = false;
          _tripsError = null;
          _isOfflineTripsData = true;
          _offlineTripsSavedAt = cached.savedAt;
        });
        return;
      }

      setState(() {
        _isLoadingTrips = false;
        _tripsError = e.toString();
        _isOfflineTripsData = false;
      });
    }
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      _loadMoreTrips();
    }
  }

  Future<void> _loadMoreTrips() async {
    if (_isLoadingMoreTrips || !_hasMoreTrips || _isLoadingTrips) return;

    setState(() {
      _isLoadingMoreTrips = true;
    });

    try {
      final result = await _tripService.fetchTripHistory(
        cursor: _nextTripsCursor,
        limit: 20,
      );
      final newTrips = result['trips'] as List<Map<String, dynamic>>;

      final stopsByTrip = <String, List<Map<String, dynamic>>>{};
      final routePointsByTrip = <String, List<Map<String, dynamic>>>{};
      final itemsByTrip = <String, List<Map<String, dynamic>>>{};

      await Future.wait(newTrips.map((trip) async {
        final tripId = trip['trip_display_id']?.toString();
        if (tripId == null || tripId.isEmpty) return;

        final results = await Future.wait([
          _tripService.fetchTripStops(tripId),
          _tripService.fetchRouteMapPoints(tripId),
          _tripService.fetchTripItems(tripId),
        ]);
        stopsByTrip[tripId] = results[0];
        routePointsByTrip[tripId] = results[1];
        itemsByTrip[tripId] = results[2];
      }));

      if (!mounted) return;

      setState(() {
        _trips.addAll(newTrips);
        _tripStopsByTripId.addAll(stopsByTrip);
        _routePointsByTripId.addAll(routePointsByTrip);
        _itemsByTripId.addAll(itemsByTrip);
        _nextTripsCursor = result['nextCursor'] as String?;
        _hasMoreTrips = result['hasMore'] as bool? ?? false;
        _isLoadingMoreTrips = false;
      });
    } catch (e) {
      debugPrint('Failed to load more trips: $e');
      if (!mounted) return;
      setState(() {
        _isLoadingMoreTrips = false;
      });
    }
  }

  Future<void> _completeCurrentStop(String tripId) async {
    final stops = _tripStopsByTripId[tripId] ?? [];
    final currentStop = stops.firstWhere(
      (stop) => stop['is_current'] == true,
      orElse: () => {},
    );

    if (currentStop.isEmpty) return;

    final tripRow = _trips.firstWhere(
      (t) => t['trip_display_id']?.toString() == tripId,
      orElse: () => <String, dynamic>{},
    );
    final netEarnings = tripRow.isNotEmpty && tripRow['net_earnings'] != null
        ? ((tripRow['net_earnings'] ?? 0) / 100).toStringAsFixed(0)
        : null;

    if (!mounted) return;
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (context) => ProofOfDeliveryScreen(
        tripDisplayId: currentStop['trip_display_id'].toString(),
        stopId: currentStop['id'].toString(),
        orderId: currentStop['order_id']?.toString(),
        earnings: netEarnings,
        onComplete: (photoPath, signPath) async {
          await SyncService.instance.queueOrSyncPoD(
            tripDisplayId: currentStop['trip_display_id'].toString(),
            stopId: currentStop['id'].toString(),
            orderId: currentStop['order_id']?.toString(),
            photoPath: photoPath,
            signaturePath: signPath,
          );
        },
      ),
    ));

    await _loadTrips();
  }

  TripStatusType _mapStatus(String? status) {
    switch (status) {
      case 'completed':
        return TripStatusType.completed;
      case 'cancelled':
        return TripStatusType.cancelled;
      case 'active':
      default:
        return TripStatusType.active;
    }
  }

  List<Trip> _mapSupabaseTripsToUiTrips() {
    return _trips.map((row) {
      final tripId = row['trip_display_id']?.toString() ?? '';
      final rawItems = _itemsByTripId[tripId] ?? [];

      final tripItems = rawItems.map((item) {
        debugPrint(item.toString()); // FIXED: Moved before return to execute properly
        return TripItem(
          customerName: item['customer_name']?.toString() ?? 'Unknown',
          goods: item['goods']?.toString() ?? '',
          destination: item['destination']?.toString() ?? '',
          earnings: '₹${((item['earnings'] ?? 0) / 100).toStringAsFixed(0)}',
          delivered: item['is_delivered'] as bool? ?? false,
          isFragile: item['is_fragile'] as bool? ?? false,
          isStackable: item['is_stackable'] as bool? ?? true,
          specialRequirements: item['special_requirements']?.toString(),
        );
      }).toList();

      return Trip(
        route: row['route_label']?.toString() ?? 'Unknown route',
        date: row['trip_date']?.toString() ?? '',
        items: tripItems.map((i) => i.goods).toList(),
        itemCount:
            '${tripItems.length} item${tripItems.length == 1 ? '' : 's'} · ${row['distance']?.toString() ?? ''}',
        distance: row['distance']?.toString() ?? '',
        earnings: '₹${((row['net_earnings'] ?? 0) / 100).toStringAsFixed(0)}',
        status: _mapStatus(row['status']?.toString()),
        tripId: tripId,
        hash: '',
        duration: row['duration']?.toString() ?? '',
        endTime: '',
        paymentBreakdown: PaymentBreakdown(
          baseFreight:
              '₹${((row['total_earnings'] ?? 0) / 100).toStringAsFixed(0)}',
          fuelDeducted: '₹0',
          tollDeducted: '₹0',
          platformFee: '₹0',
          netEarnings:
              '₹${((row['net_earnings'] is num ? row['net_earnings'] as num : 0) / 100).toStringAsFixed(0)}',
        ),
        tripItems: tripItems,
      );
    }).toList();
  }

  List<Trip> _getFilteredAndSortedTrips() {
    List<Trip> trips = _mapSupabaseTripsToUiTrips();

    if (_selectedChipIndex > 0) {
      final targetStatus = _getStatusFromIndex(_selectedChipIndex);
      trips = trips.where((t) => t.status == targetStatus).toList();
    }

    switch (_selectedSortIndex) {
      case 0:
        break;
      case 1:
        trips = trips.reversed.toList();
        break;
      case 2:
        trips.sort((a, b) =>
            _parseEarnings(b.earnings).compareTo(_parseEarnings(a.earnings)));
        break;
      case 3:
        trips.sort((a, b) =>
            _parseEarnings(a.earnings).compareTo(_parseEarnings(b.earnings)));
        break;
      case 4:
        trips.sort((a, b) => a.status.index.compareTo(b.status.index));
        break;
    }

    return trips;
  }

  TripStatusType _getStatusFromIndex(int index) {
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

  int _parseEarnings(String earnings) {
    final clean = earnings.replaceAll(RegExp(r'[^\d]'), '');
    return int.tryParse(clean) ?? 0;
  }

  int _totalEarningsPaise() => _trips.fold(
        0,
        (sum, row) {
          final val = row['net_earnings'];
          if (val is num) return sum + val.toInt();
          if (val is String) return sum + (num.tryParse(val)?.toInt() ?? 0);
          return sum +
              (val is num ? val.toInt() : int.tryParse(val.toString()) ?? 0);
        },
      );

  int _completedCount() =>
      _trips.where((r) => r['status'] == 'completed').length;

  double _completionRate() {
    final total = _trips.length;
    if (total == 0) return 0;
    return (_completedCount() / total) * 100;
  }

  String _localizedFilterLabel(BuildContext context, int index) {
    final l10n = AppLocalizations.of(context)!;
    switch (index) {
      case 0:
        return l10n.all;
      case 1:
        return l10n.active2;
      case 2:
        return l10n.completed2;
      case 3:
        return l10n.cancelled2;
      default:
        return _statusFilters[index];
    }
  }

  String _formatEarnings(int paise) {
    final rupees = paise / 100;
    if (rupees >= 100000) {
      return '₹${(rupees / 100000).toStringAsFixed(1)}L';
    } else if (rupees >= 1000) {
      return '₹${(rupees / 1000).toStringAsFixed(1)}K';
    }
    return '₹${rupees.toStringAsFixed(0)}';
  }

  Future<void> _refreshMarketplace({bool showSpinner = true}) async {
    if (!SupabaseConfig.isConfigured) {
      setState(() {
        _marketplaceLoading = false;
        _marketplaceError =
            'Supabase is not configured. Pass --dart-define=SUPABASE_URL=... and --dart-define=SUPABASE_ANON_KEY=...';
      });
      return;
    }
    if (showSpinner) {
      setState(() {
        _marketplaceLoading = true;
        _marketplaceError = null;
      });
    } else {
      setState(() => _marketplaceError = null);
    }

    try {
      final results = await Future.wait([
        _marketplaceRepository.fetchLoadOffers(),
        _marketplaceRepository.fetchEnRouteLoads(),
        _marketplaceRepository.fetchDriverBids(),
      ]);

      final standardLoads = results[0] as List<LoadOffer>;
      final enRouteLoads = results[1] as List<LoadOffer>;
      final bids = results[2] as List<DriverBid>;
      final bidsByLoad = <String, DriverBid>{
        for (final bid in bids) bid.loadId: bid,
      };

      if (!mounted) return;
      setState(() {
        _marketplaceLoads = standardLoads;
        _enRouteLoads = enRouteLoads;
        _bidsByLoadId = bidsByLoad;
        _marketplaceLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _marketplaceError = e.toString();
        _marketplaceLoading = false;
      });
    }
  }

  void _subscribeToRealtime() {
    _bidChannel = Supabase.instance.client
        .channel('driver-bids')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'load_bids',
          callback: (_) => _refreshMarketplace(),
        )
        .subscribe();
  }

  Future<Truck?> _loadDriverTruck() async {
    if (_truck != null) return _truck;
    try {
      final truck =
          await _truckRepository.fetchTruckForDriver(DriverSession.driverId);
      if (!mounted) return null;
      setState(() => _truck = truck);
      return truck;
    } catch (e) {
      debugPrint('Failed to load truck specs: $e');
      return null;
    }
  }

  Future<void> _fetchDeadheadRecommendations() async {
    final activeTrip = _trips.cast<Map<String, dynamic>?>().firstWhere(
          (t) => t?['status'] == 'active',
          orElse: () => null,
        );
    if (activeTrip == null) return;

    final tripId = activeTrip['trip_display_id']?.toString();
    if (tripId == null) return;

    final routePoints = _routePointsByTripId[tripId];
    if (routePoints == null || routePoints.isEmpty) return;

    final destination = routePoints.last;
    final destLat = (destination['latitude'] as num?)?.toDouble();
    final destLng = (destination['longitude'] as num?)?.toDouble();
    if (destLat == null || destLng == null) return;

    setState(() {
      _deadheadLoading = true;
      _deadheadError = null;
    });

    final truck = await _loadDriverTruck();
    if (truck == null ||
        truck.maxCapacityTons <= 0 ||
        truck.cargoLengthFt <= 0 ||
        truck.cargoWidthFt <= 0 ||
        truck.cargoHeightFt <= 0) {
      if (!mounted) return;
      setState(() {
        _deadheadLoading = false;
        _deadheadError = 'Add your truck details first';
      });
      return;
    }
    final truckMaxWeightKg = truck.maxCapacityTons * 1000;
    final truckMaxLengthM = truck.cargoLengthFt * 0.3048;
    final truckMaxWidthM = truck.cargoWidthFt * 0.3048;
    final truckMaxHeightM = truck.cargoHeightFt * 0.3048;

    try {
      final loads = await _marketplaceRepository.fetchLoadOffers();
      if (!mounted) return;
      if (loads.isEmpty) {
        setState(() {
          _deadheadRecommendations = const [];
          _deadheadLoading = false;
        });
        return;
      }

      final now = DateTime.now();
      final payload = _marketplaceRepository.buildDeadheadPayload(
        loads: loads,
        driverLat: destLat,
        driverLng: destLng,
        truckMaxWeightKg: truckMaxWeightKg,
        truckMaxLengthM: truckMaxLengthM,
        truckMaxWidthM: truckMaxWidthM,
        truckMaxHeightM: truckMaxHeightM,
        arrivalTime: now.add(const Duration(hours: 6)).toIso8601String(),
      );
      final availableLoadMaps =
          payload['available_loads'] as List<Map<String, dynamic>>;

      final recommendations =
          await _marketplaceRepository.fetchDeadheadRecommendations(
        destLat: destLat,
        destLng: destLng,
        maxWeightKg: truckMaxWeightKg,
        maxLengthM: truckMaxLengthM,
        maxWidthM: truckMaxWidthM,
        maxHeightM: truckMaxHeightM,
        arrivalTime: now.add(const Duration(hours: 6)).toIso8601String(),
        availableLoads: availableLoadMaps,
      );

      if (!mounted) return;

      final enrichedRecs = recommendations.map((rec) {
        final matchingLoad = loads.firstWhere(
          (l) => l.id == rec.loadId,
          orElse: () => const LoadOffer(
            id: '',
            route: '',
            customer: '',
            company: '',
            goods: '',
            pickup: '',
            distanceFromDriver: '',
            estimatedProfit: '',
            fuelCost: '',
            tollCost: '',
            capacityUsed: 0,
            truckFillLabel: '',
            sharingTruckWith: '',
            badgeLabel: '',
            badgeEmoji: '',
            routeDistance: '',
            routeDuration: '',
            weight: '',
            dimensions: '',
            stackable: '',
            fragile: '',
            specialHandling: '',
            freightValue: '',
            netProfit: '',
            routeNote: '',
            extraDistance: 0,
            extraEarnings: '',
            spaceAvailable: '',
            updatedTotalEarnings: '',
          ),
        );
        return DeadheadRecommendation(
          loadId: rec.loadId,
          distanceToPickupKm: rec.distanceToPickupKm,
          matchScore: rec.matchScore,
          detourKm: rec.detourKm,
          estimatedEarnings: rec.estimatedEarnings,
          route: matchingLoad.route.isNotEmpty ? matchingLoad.route : rec.loadId,
          goodsType: matchingLoad.goods,
          pickup: matchingLoad.pickup,
          drop: matchingLoad.route,
          weight: matchingLoad.weight,
        );
      }).toList();

      setState(() {
        _deadheadRecommendations = enrichedRecs;
        _deadheadLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _deadheadError = e.toString();
        _deadheadLoading = false;
      });
    }
  }

  @override
  void dispose() {
    SyncService.instance.stopListening();
    _scrollController.dispose();
    if (SupabaseConfig.isConfigured && _bidChannel != null) {
      Supabase.instance.client.removeChannel(_bidChannel!);
    }
    super.dispose();
  }

  void _showSortBottomSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        int tempSortIndex = _selectedSortIndex;
        return StatefulBuilder(
          builder: (context, setBottomSheetState) {
            return Padding(
              padding: EdgeInsets.only(
                left: 16,
                right: 16,
                top: 12,
                bottom: MediaQuery.of(context).viewInsets.bottom + 16,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const BottomSheetHandle(),
                  const SizedBox(height: 16),
                  Text(
                    AppLocalizations.of(context)!.sortTrips,
                    style: GoogleFonts.dmSans(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 20),
                  _buildSortOption(
                      context,
                      AppLocalizations.of(context)!.newestFirst,
                      0,
                      tempSortIndex, (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(
                      context,
                      AppLocalizations.of(context)!.oldestFirst,
                      1,
                      tempSortIndex, (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(
                      context,
                      AppLocalizations.of(context)!.highestEarnings,
                      2,
                      tempSortIndex, (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(
                      context,
                      AppLocalizations.of(context)!.lowestEarnings,
                      3,
                      tempSortIndex, (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(context,
                      AppLocalizations.of(context)!.byStatus, 4, tempSortIndex,
                      (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: ElevatedButton(
                      onPressed: () {
                        setState(() => _selectedSortIndex = tempSortIndex);
                        Navigator.pop(context);
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: TruxifyColors.accent,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        elevation: 0,
                      ),
                      child: Text(
                        AppLocalizations.of(context)!.apply,
                        style: GoogleFonts.dmSans(
                          color: Theme.of(context).colorScheme.surface,
                          fontWeight: FontWeight.w600,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildSortOption(
    BuildContext context,
    String label,
    int index,
    int selectedIndex,
    ValueChanged<int> onTap,
  ) {
    final isSelected = index == selectedIndex;
    return GestureDetector(
      onTap: () => onTap(index),
      behavior: HitTestBehavior.opaque,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected ? TruxifyColors.accentLight : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: [
            Container(
              width: 18,
              height: 18,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: isSelected
                      ? TruxifyColors.accent
                      : (Theme.of(context).brightness == Brightness.dark
                          ? TruxifyColors.darkBorder
                          : TruxifyColors.border),
                  width: 2,
                ),
              ),
              child: isSelected
                  ? Center(
                      child: Container(
                        width: 8,
                        height: 8,
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          color: TruxifyColors.accent,
                        ),
                      ),
                    )
                  : null,
            ),
            const SizedBox(width: 12),
            Text(
              label,
              style: GoogleFonts.dmSans(
                fontSize: 14,
                color: isSelected
                    ? Colors.black87
                    : Theme.of(context).colorScheme.onSurface,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Scaffold(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        body: Column(
          children: [
            Container(
              color: Theme.of(context).colorScheme.surface,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Text(
                        _topTabIndex == 0
                            ? AppLocalizations.of(context)!.myTrips
                            : AppLocalizations.of(context)!.marketplace,
                        style: GoogleFonts.dmSans(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: Theme.of(context).colorScheme.onSurface,
                        ),
                      ),
                      const SizedBox(width: 10),
                      _TopTabToggle(
                        index: _topTabIndex,
                        onChanged: (value) =>
                            setState(() => _topTabIndex = value),
                      ),
                    ],
                  ),
                  if (_topTabIndex == 0)
                    InkWell(
                      onTap: _showSortBottomSheet,
                      borderRadius: BorderRadius.circular(20),
                      child: const Padding(
                        padding: EdgeInsets.all(4.0),
                        child: Icon(
                          Icons.tune,
                          color: TruxifyColors.accent,
                          size: 22,
                        ),
                      ),
                    )
                  else
                    InkWell(
                      onTap: () => _refreshMarketplace(showSpinner: true),
                      borderRadius: BorderRadius.circular(20),
                      child: const Padding(
                        padding: EdgeInsets.all(4.0),
                        child: Icon(
                          Icons.refresh_rounded,
                          color: TruxifyColors.accent,
                          size: 22,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Container(height: 1, color: TruxifyColors.border),
            if (_topTabIndex == 1)
              Expanded(
                child: RefreshIndicator(
                  color: TruxifyColors.accent,
                  onRefresh: () => _refreshMarketplace(showSpinner: false),
                  child: _MarketplaceBody(
                    loading: _marketplaceLoading,
                    error: _marketplaceError,
                    standardLoads: _marketplaceLoads,
                    enRouteLoads: _enRouteLoads,
                    bidsByLoadId: _bidsByLoadId,
                    submittingLoadIds: _submittingLoadIds,
                    onOpenLoad: (load) => Navigator.of(context)
                        .pushNamed(AppRoutes.loadDetail, arguments: load),
                    onSubmitBid: (load, amount) async {
                      final loadId = load.id;
                      if (loadId.isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                              content: Text(AppLocalizations.of(context)!
                                  .thisLoadIsMissingId)),
                        );
                        return;
                      }
                      if (_submittingLoadIds.contains(loadId)) {
                        return;
                      }

                      if (!mounted) return;
                      setState(() {
                        _submittingLoadIds = <String>{
                          ..._submittingLoadIds,
                          loadId
                        };
                      });

                      try {
                        await _bidSubmissionGuard.run<DriverBid>(
                          loadId: loadId,
                          action: () async =>
                              _marketplaceRepository.submitBid(
                            loadId: loadId,
                            amount: amount,
                          ),
                        );
                        if (!mounted) return;
                        _refreshMarketplace(showSpinner: false);
                      } catch (e) {
                        if (!mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Failed to submit bid: $e')),
                        );
                      } finally {
                        if (mounted) {
                          setState(() {
                            _submittingLoadIds = _submittingLoadIds
                                .where((id) => id != loadId)
                                .toSet();
                          });
                        }
                      }
                    },
                  ),
                ),
              )
            else
              Expanded(
                child: _TripsBody(
                  loading: _isLoadingTrips,
                  error: _tripsError,
                  trips: _getFilteredAndSortedTrips(),
                  stopsByTripId: _tripStopsByTripId,
                  routePointsByTripId: _routePointsByTripId,
                  statusFilters: _statusFilters,
                  selectedChipIndex: _selectedChipIndex,
                  onChipSelected: (index) => setState(() => _selectedChipIndex = index),
                  onRefresh: _loadTrips,
                  onCompleteStop: _completeCurrentStop,
                  isOfflineData: _isOfflineTripsData,
                  offlineSavedAt: _offlineTripsSavedAt,
                  deadheadRecommendations: _deadheadRecommendations,
                  deadheadLoading: _deadheadLoading,
                  deadheadError: _deadheadError,
                  onOpenDeadheadLoad: (rec) {
                    final load = _marketplaceLoads.firstWhere(
                      (l) => l.id == rec.loadId,
                      orElse: () => LoadOffer(
                        id: rec.loadId,
                        route: rec.route,
                        customer: '',
                        company: '',
                        goods: rec.goodsType,
                        pickup: rec.pickup,
                        distanceFromDriver: '${rec.distanceToPickupKm.toStringAsFixed(1)} km',
                        estimatedProfit: '₹${rec.estimatedEarnings}',
                        fuelCost: '',
                        tollCost: '',
                        capacityUsed: 0,
                        truckFillLabel: '',
                        sharingTruckWith: '',
                        badgeLabel: '',
                        badgeEmoji: '',
                        routeDistance: '',
                        routeDuration: '',
                        weight: rec.weight,
                        dimensions: '',
                        stackable: '',
                        fragile: '',
                        specialHandling: '',
                        freightValue: '',
                        netProfit: '₹${rec.estimatedEarnings}',
                        routeNote: '',
                        extraDistance: rec.detourKm.toInt(),
                        extraEarnings: '₹${rec.estimatedEarnings}',
                        spaceAvailable: '',
                        updatedTotalEarnings: '',
                      ),
                    );
                    Navigator.of(context).pushNamed(AppRoutes.loadDetail, arguments: load);
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// Supporting Helper Widgets for UI structure
class _TopTabToggle extends StatelessWidget {
  final int index;
  final ValueChanged<int> onChanged;

  const _TopTabToggle({required this.index, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark
            ? TruxifyColors.darkSurfaceVariant
            : TruxifyColors.surfaceVariant,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildTab(context, AppLocalizations.of(context)!.myTrips, 0),
          _buildTab(context, AppLocalizations.of(context)!.marketplace, 1),
        ],
      ),
    );
  }

  Widget _buildTab(BuildContext context, String text, int tabIndex) {
    final isSelected = index == tabIndex;
    return GestureDetector(
      onTap: () => onChanged(tabIndex),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? TruxifyColors.accent : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          text,
          style: GoogleFonts.dmSans(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: isSelected ? Colors.white : Theme.of(context).colorScheme.onSurface,
          ),
        ),
      ),
    );
  }
}

class _MarketplaceBody extends StatelessWidget {
  final bool loading;
  final String? error;
  final List<LoadOffer> standardLoads;
  final List<LoadOffer> enRouteLoads;
  final Map<String, DriverBid> bidsByLoadId;
  final Set<String> submittingLoadIds;
  final ValueChanged<LoadOffer> onOpenLoad;
  final Function(LoadOffer, double) onSubmitBid;

  const _MarketplaceBody({
    required this.loading,
    required this.error,
    required this.standardLoads,
    required this.enRouteLoads,
    required this.bidsByLoadId,
    required this.submittingLoadIds,
    required this.onOpenLoad,
    required this.onSubmitBid,
  });

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(child: CircularProgressIndicator(color: TruxifyColors.accent));
    }
    if (error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Text(error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.red)),
        ),
      );
    }
    if (standardLoads.isEmpty && enRouteLoads.isEmpty) {
      return Center(
        child: Text(AppLocalizations.of(context)!.noLoadsAvailable),
      );
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (enRouteLoads.isNotEmpty) ...[
          Text(AppLocalizations.of(context)!.enRouteBackhauls,
              style: GoogleFonts.dmSans(fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          ...enRouteLoads.map((load) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: LoadCard(
                  load: load,
                  existingBid: bidsByLoadId[load.id],
                  isSubmitting: submittingLoadIds.contains(load.id),
                  onTap: () => onOpenLoad(load),
                  onSubmitBid: (amt) => onSubmitBid(load, amt),
                ),
              )),
          const SizedBox(height: 20),
        ],
        Text(AppLocalizations.of(context)!.availableLoads,
            style: GoogleFonts.dmSans(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        ...standardLoads.map((load) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: LoadCard(
                load: load,
                existingBid: bidsByLoadId[load.id],
                isSubmitting: submittingLoadIds.contains(load.id),
                onTap: () => onOpenLoad(load),
                onSubmitBid: (amt) => onSubmitBid(load, amt),
              ),
            )),
      ],
    );
  }
}

class _TripsBody extends StatelessWidget {
  final bool loading;
  final String? error;
  final List<Trip> trips;
  final Map<String, List<Map<String, dynamic>>> stopsByTripId;
  final Map<String, List<Map<String, dynamic>>> routePointsByTripId;
  final List<String> statusFilters;
  final int selectedChipIndex;
  final ValueChanged<int> onChipSelected;
  final VoidCallback onRefresh;
  final Function(String) onCompleteStop;
  final bool isOfflineData;
  final DateTime? offlineSavedAt;
  final List<DeadheadRecommendation> deadheadRecommendations;
  final bool deadheadLoading;
  final String? deadheadError;
  final ValueChanged<DeadheadRecommendation> onOpenDeadheadLoad;

  const _TripsBody({
    required this.loading,
    required this.error,
    required this.trips,
    required this.stopsByTripId,
    required this.routePointsByTripId,
    required this.statusFilters,
    required this.selectedChipIndex,
    required this.onChipSelected,
    required this.onRefresh,
    required this.onCompleteStop,
    required this.isOfflineData,
    required this.offlineSavedAt,
    required this.deadheadRecommendations,
    required this.deadheadLoading,
    required this.deadheadError,
    required this.onOpenDeadheadLoad,
  });

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(child: CircularProgressIndicator(color: TruxifyColors.accent));
    }
    if (error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.red)),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: onRefresh, child: Text(AppLocalizations.of(context)!.retry)),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      color: TruxifyColors.accent,
      onRefresh: () async => onRefresh(),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (isOfflineData) ...[
            Container(
              padding: const EdgeInsets.all(10),
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: Colors.amber.withOpacity(0.15),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.amber),
              ),
              child: Row(
                children: [
                  const Icon(Icons.offline_bolt, color: Colors.amber, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      AppLocalizations.of(context)!.showingCachedOfflineData,
                      style: GoogleFonts.dmSans(fontSize: 12, color: Colors.amber[800]),
                    ),
                  ),
                ],
              ),
            ),
          ],
          SizedBox(
            height: 38,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: statusFilters.length,
              itemBuilder: (context, index) {
                final isSelected = selectedChipIndex == index;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(_localizedFilterLabel(context, index)),
                    selected: isSelected,
                    onSelected: (_) => onChipSelected(index),
                    selectedColor: TruxifyColors.accent,
                    labelStyle: GoogleFonts.dmSans(
                      color: isSelected ? Colors.white : Theme.of(context).colorScheme.onSurface,
                      fontSize: 12,
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          if (trips.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 40),
              child: Center(
                child: Text(AppLocalizations.of(context)!.noTripsFound),
              ),
            )
          else
            ...trips.map((trip) {
              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: TripCard(
                  trip: trip,
                  stops: stopsByTripId[trip.tripId] ?? [],
                  routePoints: routePointsByTripId[trip.tripId] ?? [],
                  onCompleteStop: () => onCompleteStop(trip.tripId),
                ),
              );
            }),
          if (deadheadRecommendations.isNotEmpty || deadheadLoading) ...[
            const SizedBox(height: 24),
            Text(
              AppLocalizations.of(context)!.deadheadRecommendations,
              style: GoogleFonts.dmSans(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            if (deadheadLoading)
              const Center(child: CircularProgressIndicator(color: TruxifyColors.accent))
            else
              ...deadheadRecommendations.map((rec) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: DeadheadRecommendationCard(
                      recommendation: rec,
                      onTap: () => onOpenDeadheadLoad(rec),
                    ),
                  )),
          ],
        ],
      ),
    );
  }

  String _localizedFilterLabel(BuildContext context, int index) {
    final l10n = AppLocalizations.of(context)!;
    switch (index) {
      case 0:
        return l10n.all;
      case 1:
        return l10n.active2;
      case 2:
        return l10n.completed2;
      case 3:
        return l10n.cancelled2;
      default:
        return statusFilters[index];
    }
  }
}
