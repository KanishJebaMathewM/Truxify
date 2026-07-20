import 'dart:async';
import 'package:flutter/material.dart';
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
    final itemsByTrip = <String, List<Map<String, dynamic>>>{};   // ← add this

    await Future.wait(trips.map((trip) async {
      final tripId = trip['trip_display_id']?.toString();
      if (tripId == null || tripId.isEmpty) return;

      final results = await Future.wait([
        _tripService.fetchTripStops(tripId),
        _tripService.fetchRouteMapPoints(tripId),
        _tripService.fetchTripItems(tripId),   
      ]);
      stopsByTrip[tripId] = results[0];
      routePointsByTrip[tripId]= results[1];
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

      // Cache the freshly loaded trips so they remain available if a later
      // load fails because the network is unavailable mid-trip.
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
    if (_scrollController.position.pixels >= _scrollController.position.maxScrollExtent - 200) {
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

    if (!mounted) return;
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (context) => ProofOfDeliveryScreen(
        tripDisplayId: currentStop['trip_display_id'].toString(),
        stopId: currentStop['id'].toString(),
        onComplete: (photoPath, signPath) async {
          await SyncService.instance.queueOrSyncPoD(
            tripDisplayId: currentStop['trip_display_id'].toString(),
            stopId: currentStop['id'].toString(),
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
      return TripItem(
        customerName: item['customer_name']?.toString() ?? 'Unknown',
        goods: item['goods']?.toString() ?? '',
        destination: item['destination']?.toString() ?? '',
        earnings: '₹${((item['earnings'] ?? 0) / 100).toStringAsFixed(0)}',
        delivered: item['is_delivered'] as bool? ?? false,
        isFragile: item['is_fragile'] as bool? ?? false,
        isStackable: item['is_stackable'] as bool? ?? true,
        specialRequirements:
          item['special_requirements']?.toString(),
      );
      debugPrint(item.toString());
    }).toList();

    return Trip(
      route: row['route_label']?.toString() ?? 'Unknown route',
      date: row['trip_date']?.toString() ?? '',
      items: tripItems.map((i) => i.goods).toList(),
      itemCount: row['distance']?.toString() ?? '',
      distance: row['distance']?.toString() ?? '',
      earnings: '₹${((row['net_earnings'] ?? 0) / 100).toStringAsFixed(0)}',
      status: _mapStatus(row['status']?.toString()),
      tripId: tripId,
      hash: '',
      duration: row['duration']?.toString() ?? '',
      endTime: '',
      paymentBreakdown: PaymentBreakdown(
        baseFreight: '₹${((row['total_earnings'] ?? 0) / 100).toStringAsFixed(0)}',
        fuelDeducted: '₹0',
        tollDeducted: '₹0',
        platformFee: '₹0',
        netEarnings: '₹${((row['net_earnings'] ?? 0) / 100).toStringAsFixed(0)}',
      ),
      tripItems: tripItems,
    );
  }).toList();
}

  List<Trip> _getFilteredAndSortedTrips() {
    List<Trip> trips = _mapSupabaseTripsToUiTrips();

    // Filter by status
    if (_selectedChipIndex > 0) {
      final targetStatus = _getStatusFromIndex(_selectedChipIndex);
      trips = trips.where((t) => t.status == targetStatus).toList();
    }

    // Sort
    switch (_selectedSortIndex) {
      case 0: // Newest first — fetchTrips already orders by trip_date desc
        break;
      case 1: // Oldest first
        trips = trips.reversed.toList();
        break;
      case 2: // Highest earnings
        trips.sort((a, b) =>
            _parseEarnings(b.earnings).compareTo(_parseEarnings(a.earnings)));
        break;
      case 3: // Lowest earnings
        trips.sort((a, b) =>
            _parseEarnings(a.earnings).compareTo(_parseEarnings(b.earnings)));
        break;
      case 4: // By status (Active → Completed → Cancelled)
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
        (sum, row) => sum + ((row['net_earnings'] ?? 0) as num).toInt(),
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

      final availableLoadMaps = loads.map((load) {
        return <String, dynamic>{
          'load_id': load.id,
          'origin_lat': 0.0,
          'origin_lng': 0.0,
          'dest_lat': 0.0,
          'dest_lng': 0.0,
          'weight_kg': 0.0,
          'length_m': 0.0,
          'width_m': 0.0,
          'height_m': 0.0,
          'pickup_deadline':
              DateTime.now().add(const Duration(days: 7)).toIso8601String(),
          'payment_inr': 0.0,
        };
      }).toList();

      final now = DateTime.now();
      final recommendations = await _marketplaceRepository
          .fetchDeadheadRecommendations(
        destLat: destLat,
        destLng: destLng,
        maxWeightKg: 25000,
        maxLengthM: 12,
        maxWidthM: 2.5,
        maxHeightM: 4,
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
                  _buildSortOption(context, AppLocalizations.of(context)!.newestFirst, 0, tempSortIndex,
                      (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(context, AppLocalizations.of(context)!.oldestFirst, 1, tempSortIndex,
                      (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(
                      context, AppLocalizations.of(context)!.highestEarnings, 2, tempSortIndex, (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(context, AppLocalizations.of(context)!.lowestEarnings, 3, tempSortIndex,
                      (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(context, AppLocalizations.of(context)!.byStatus, 4, tempSortIndex,
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
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final trips = _getFilteredAndSortedTrips();

    return SafeArea(
      child: Scaffold(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        body: Column(
          children: [
            // Top Bar
            Container(
              color: Theme.of(context).colorScheme.surface,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Text(
                        _topTabIndex == 0 ? AppLocalizations.of(context)!.myTrips : AppLocalizations.of(context)!.marketplace,
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
                              content: Text(AppLocalizations.of(context)!.thisLoadIsMissingId)),
                        );
                        return;
                      }
                      if (_submittingLoadIds.contains(loadId)) {
                        return;
                      }

                      if (!mounted) return;
                      setState(() {
                        _submittingLoadIds = <String>{..._submittingLoadIds, loadId};
                      });

                      try {
                        final bid = await _bidSubmissionGuard.run<DriverBid>(
                          loadId: loadId,
                          action: () async => _marketplaceRepository.submitBid(
                            loadId: loadId,
                            amount: amount,
                          ),
                        );
                        if (!context.mounted) return;
                        setState(() {
                          _bidsByLoadId = <String, DriverBid>{
                            ..._bidsByLoadId,
                            bid.loadId: bid,
                          };
                        });
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                              content: Text(AppLocalizations.of(context)!.bidSubmitted)),
                        );
                      } catch (e) {
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text(AppLocalizations.of(context)!.failedToSubmitBid)),
                        );
                      } finally {
                        if (!mounted) return;
                        setState(() {
                          _submittingLoadIds = <String>{
                            ..._submittingLoadIds.where((id) => id != loadId),
                          };
                        });
                      }
                    },
                  ),
                ),
              )
            else ...[
              // Summary Strip — computed from real trip data
              Container(
                color: Theme.of(context).colorScheme.surface,
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        children: [
                          Text(
                            '${_trips.length}',
                            style: GoogleFonts.dmSans(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: TruxifyColors.accent,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            AppLocalizations.of(context)!.totalTrips,
                            style: GoogleFonts.dmSans(
                              fontSize: 10,
                              color:
                                  TruxifyColors.adaptiveSecondaryText(context),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                        width: 1, height: 32, color: TruxifyColors.border),
                    Expanded(
                      child: Column(
                        children: [
                          Text(
                            _formatEarnings(_totalEarningsPaise()),
                            style: GoogleFonts.dmSans(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: TruxifyColors.accent,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            AppLocalizations.of(context)!.totalEarned,
                            style: GoogleFonts.dmSans(
                              fontSize: 10,
                              color:
                                  TruxifyColors.adaptiveSecondaryText(context),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                        width: 1, height: 32, color: TruxifyColors.border),
                    Expanded(
                      child: Column(
                        children: [
                          Text(
                            '${_completionRate().toStringAsFixed(0)}%',
                            style: GoogleFonts.dmSans(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: TruxifyColors.accent,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            AppLocalizations.of(context)!.completion,
                            style: GoogleFonts.dmSans(
                              fontSize: 10,
                              color:
                                  TruxifyColors.adaptiveSecondaryText(context),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Container(height: 1, color: TruxifyColors.border),

              // Filter Chips
              Container(
                height: 52,
                color: Theme.of(context).colorScheme.surface,
                child: ListView.builder(
                  scrollDirection: Axis.horizontal,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  itemCount: _statusFilters.length,
                  itemBuilder: (context, index) {
                    final isSelected = index == _selectedChipIndex;
                    return GestureDetector(
                      onTap: () => setState(() => _selectedChipIndex = index),
                      child: Container(
                        margin: const EdgeInsets.only(right: 8),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 6),
                        decoration: BoxDecoration(
                          color: isSelected
                              ? TruxifyColors.accent
                              : (isDark
                                  ? TruxifyColors.darkSecondaryBackground
                                  : Colors.white),
                          border: Border.all(
                            color: isSelected
                                ? TruxifyColors.accent
                                : (isDark
                                    ? TruxifyColors.darkBorder
                                    : TruxifyColors.border),
                          ),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Center(
                          child: Text(
                            _localizedFilterLabel(context, index),
                            style: GoogleFonts.dmSans(
                              fontSize: 12,
                              fontWeight: isSelected
                                  ? FontWeight.w600
                                  : FontWeight.normal,
                              color: isSelected
                                  ? Colors.white
                                  : TruxifyColors.adaptiveSecondaryText(
                                      context),
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),

              if (_isOfflineTripsData)
                _OfflineTripsBanner(savedAt: _offlineTripsSavedAt),

              // Trips List
              Expanded(
                child: RefreshIndicator(
                  color: TruxifyColors.accent,
                  onRefresh: () async {
                    await _loadTrips();
                    await _fetchDeadheadRecommendations();
                  },
                  child: _isLoadingTrips
                      ? ListView.builder(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          itemCount: 3,
                          itemBuilder: (context, index) =>
                              const ShimmerListItem(height: 180),
                        )
                      : _tripsError != null
                          ? ListView(
                              physics: const AlwaysScrollableScrollPhysics(),
                              padding: const EdgeInsets.all(16),
                              children: [
                                const SizedBox(height: 40),
                                Center(
                                  child: Text(
                                    AppLocalizations.of(context)!.failedToLoadTrips,
                                    textAlign: TextAlign.center,
                                    style: GoogleFonts.dmSans(
                                      color:
                                          TruxifyColors.adaptiveSecondaryText(
                                              context),
                                      fontSize: 14,
                                    ),
                                  ),
                                ),
                              ],
                            )
                          : trips.isEmpty &&
                                  _deadheadRecommendations.isEmpty &&
                                  !_deadheadLoading &&
                                  _deadheadError == null
                              ? ListView(
                                  physics:
                                      const AlwaysScrollableScrollPhysics(),
                                  children: [
                                    const SizedBox(height: 80),
                                    Center(
                                      child: Text(
                                        AppLocalizations.of(context)!.noTripsFound,
                                        style: GoogleFonts.dmSans(
                                          color: TruxifyColors
                                              .adaptiveSecondaryText(context),
                                          fontSize: 14,
                                        ),
                                      ),
                                    ),
                                  ],
                                )
                              : ListView.builder(
                                  controller: _scrollController,
                                  physics:
                                      const AlwaysScrollableScrollPhysics(),
                                  padding: const EdgeInsets.all(12),
                                  itemCount:
                                      (_deadheadRecommendations.isNotEmpty ||
                                              _deadheadLoading ||
                                              _deadheadError != null
                                          ? 1
                                          : 0) +
                                          _deadheadRecommendations.length +
                                          1 +
                                          trips.length +
                                          (_hasMoreTrips && trips.isNotEmpty
                                              ? 1
                                              : 0),
                                  itemBuilder: (context, index) {
                                    final hasRecs =
                                        _deadheadRecommendations.isNotEmpty;
                                    final showDeadheadHeader = hasRecs ||
                                        _deadheadLoading ||
                                        _deadheadError != null;
                                    if (showDeadheadHeader && index == 0) {
                                      return Padding(
                                        padding: const EdgeInsets.only(
                                            bottom: 4),
                                        child: Row(
                                          mainAxisAlignment:
                                              MainAxisAlignment.spaceBetween,
                                          children: [
                                            Expanded(
                                              child: Text(
                                                AppLocalizations.of(context)!
                                                    .recommendedReturnLoads,
                                                style: Theme.of(context)
                                                    .textTheme
                                                    .titleMedium
                                                    ?.copyWith(
                                                      fontWeight:
                                                          FontWeight.w800,
                                                    ),
                                              ),
                                            ),
                                            if (_deadheadLoading)
                                              const SizedBox(
                                                width: 16,
                                                height: 16,
                                                child:
                                                    CircularProgressIndicator(
                                                        strokeWidth: 2),
                                              )
                                            else if (_deadheadError != null)
                                              GestureDetector(
                                                onTap:
                                                    _fetchDeadheadRecommendations,
                                                child: Text(
                                                  AppLocalizations.of(context)!
                                                      .retry,
                                                  style: GoogleFonts.dmSans(
                                                    fontSize: 12,
                                                    color:
                                                        TruxifyColors.accent,
                                                  ),
                                                ),
                                              ),
                                          ],
                                        ),
                                      );
                                    }

                                    final recStart =
                                        showDeadheadHeader ? 1 : 0;
                                    if (index >= recStart &&
                                        index <
                                            recStart +
                                                _deadheadRecommendations
                                                    .length) {
                                      final recIndex = index - recStart;
                                      final rec = _deadheadRecommendations[recIndex];
                                      final bid =
                                          _deadheadBidsByLoadId[rec.loadId];
                                      final isSubmitting =
                                          _submittingDeadheadLoadIds
                                              .contains(rec.loadId);
                                      return DeadheadRecommendationCard(
                                        recommendation: rec,
                                        bid: bid,
                                        isSubmitting: isSubmitting,
                                        onOpenLoad: () => Navigator.of(context)
                                            .pushNamed(AppRoutes.loadDetail),
                                        onBid: (amount) async {
                                          final loadId = rec.loadId;
                                          if (loadId.isEmpty) return;
                                          if (_submittingDeadheadLoadIds
                                              .contains(loadId)) return;
                                          if (!mounted) return;
                                          setState(() {
                                            _submittingDeadheadLoadIds = {
                                              ..._submittingDeadheadLoadIds,
                                              loadId,
                                            };
                                          });
                                          try {
                                            final newBid =
                                                await _bidSubmissionGuard
                                                    .run<DriverBid>(
                                              loadId: loadId,
                                              action: () async =>
                                                  _marketplaceRepository
                                                      .submitBid(
                                                loadId: loadId,
                                                amount: amount,
                                              ),
                                            );
                                            if (!mounted) return;
                                            setState(() {
                                              _deadheadBidsByLoadId = {
                                                ..._deadheadBidsByLoadId,
                                                newBid.loadId: newBid,
                                              };
                                              _bidsByLoadId = {
                                                ..._bidsByLoadId,
                                                newBid.loadId: newBid,
                                              };
                                            });
                                            if (context.mounted) {
                                              ScaffoldMessenger.of(context)
                                                  .showSnackBar(SnackBar(
                                                content: Text(
                                                    AppLocalizations.of(
                                                            context)!
                                                        .bidSubmitted),
                                              ));
                                            }
                                          } catch (e) {
                                            if (!mounted) return;
                                            if (context.mounted) {
                                              ScaffoldMessenger.of(context)
                                                  .showSnackBar(SnackBar(
                                                content: Text(
                                                    AppLocalizations.of(
                                                            context)!
                                                        .failedToSubmitBid),
                                              ));
                                            }
                                          } finally {
                                            if (!mounted) return;
                                            setState(() {
                                              _submittingDeadheadLoadIds = {
                                                ..._submittingDeadheadLoadIds
                                                    .where(
                                                        (id) => id != loadId),
                                              };
                                            });
                                          }
                                        },
                                      );
                                    }
                                    final recCount =
                                        hasRecs
                                            ? _deadheadRecommendations.length
                                            : 0;
                                    final tripStart = recStart + recCount + 1;
                                    if (index == tripStart - 1) {
                                      return const SizedBox.shrink();
                                    }
                                    final tripIndex = index - tripStart;
                                    if (tripIndex >= 0 &&
                                        tripIndex == trips.length) {
                                      return const Padding(
                                        padding:
                                            EdgeInsets.symmetric(vertical: 16.0),
                                        child: Center(
                                            child:
                                                CircularProgressIndicator()),
                                      );
                                    }
                                    if (tripIndex >= 0 &&
                                        tripIndex < trips.length) {
                                      return _buildTripCard(
                                          context, trips[tripIndex]);
                                    }
                                    return const SizedBox.shrink();
                                  },
                                ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildLiveStopsPreview(String tripId) {
    final stops = _tripStopsByTripId[tripId] ?? [];
    if (stops.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 8),
        if (stops.any((stop) => stop['is_current'] == true))
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () => _completeCurrentStop(tripId),
              style: ElevatedButton.styleFrom(
                backgroundColor: TruxifyColors.accent,
              ),
              child: Text(AppLocalizations.of(context)!.markCurrentStopCompleted),
            ),
          ),
        const SizedBox(height: 10),
          Text(
          AppLocalizations.of(context)!.deliveryStops,
          style: GoogleFonts.dmSans(
            fontSize: 12,
            fontWeight: FontWeight.bold,
            color: TruxifyColors.accent,
          ),
        ),
        const SizedBox(height: 6),
        ...stops.map((stop) {
          final isCompleted = stop['is_completed'] == true;
          final isCurrent = stop['is_current'] == true;
          return Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              '${isCompleted ? "✅" : isCurrent ? "🔄" : "⏳"} '
              '${stop['customer_name']} → ${stop['drop_location']}',
              style: GoogleFonts.dmSans(
                fontSize: 11,
                color: Theme.of(context).colorScheme.onSurface,
              ),
            ),
          );
        }),
      ],
    );
  }

  Widget _buildTripCard(BuildContext context, Trip trip) {
    final routePoints = _routePointsByTripId[trip.tripId] ?? [];

    Color statusColor;
    Color statusBgColor;
    String statusLabel;

    switch (trip.status) {
      case TripStatusType.active:
        statusColor = TruxifyColors.accent;
        statusBgColor = TruxifyColors.accentLight;
        statusLabel = AppLocalizations.of(context)!.activeStatus;
        break;
      case TripStatusType.completed:
        statusColor = TruxifyColors.success;
        statusBgColor = TruxifyColors.successLight;
        statusLabel = AppLocalizations.of(context)!.completedStatus;
        break;
      case TripStatusType.cancelled:
        statusColor = TruxifyColors.errorRed;
        statusBgColor = TruxifyColors.errorLight;
        statusLabel = AppLocalizations.of(context)!.cancelledStatus;
        break;
    }

    return GestureDetector(
      onTap: () =>
          Navigator.pushNamed(context, AppRoutes.tripDetail, arguments: trip),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: Theme.of(context).brightness == Brightness.dark
                ? TruxifyColors.darkBorder
                : TruxifyColors.border,
          ),
          boxShadow: [
            BoxShadow(
              color: TruxifyColors.accent.withValues(alpha: 0.06),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: Row(
            children: [
              Container(
                width: 4,
                height: 120,
                color: statusColor,
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(14.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Route map thumbnail
                      SizedBox(
                        height: 86,
                        child: _buildRouteMap(routePoints),
                      ),
                      const SizedBox(height: 8),
                      _buildLiveStopsPreview(trip.tripId),
                      const SizedBox(height: 8),
                      // Route + status badge
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Text(
                              trip.route,
                              style: GoogleFonts.dmSans(
                                fontSize: 15,
                                fontWeight: FontWeight.bold,
                                color: Theme.of(context).colorScheme.onSurface,
                              ),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 10, vertical: 3),
                            decoration: BoxDecoration(
                              color: statusBgColor,
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              statusLabel,
                              style: GoogleFonts.dmSans(
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                color: statusColor,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        trip.date,
                        style: GoogleFonts.dmSans(
                          fontSize: 11,
                          color: TruxifyColors.adaptiveSecondaryText(context),
                        ),
                      ),
                      const SizedBox(height: 8),
                      // Items chips
                      trip.items.isEmpty
                          ? Text(
                              '—',
                              style: GoogleFonts.dmSans(
                                fontSize: 10,
                                color: TruxifyColors.adaptiveSecondaryText(
                                    context),
                              ),
                            )
                          : SingleChildScrollView(
                              scrollDirection: Axis.horizontal,
                              child: Row(
                                children: trip.items.map((item) {
                                  return Container(
                                    margin: const EdgeInsets.only(right: 6),
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: Theme.of(context).brightness ==
                                              Brightness.dark
                                          ? TruxifyColors.darkAccentLight
                                          : TruxifyColors.accentLight,
                                      border: Border.all(
                                          color: TruxifyColors.border),
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: Text(
                                      item,
                                      style: GoogleFonts.dmSans(
                                        fontSize: 10,
                                        color: Theme.of(context).brightness ==
                                                Brightness.dark
                                            ? TruxifyColors.darkPrimaryText
                                            : TruxifyColors.accent,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  );
                                }).toList(),
                              ),
                            ),
                      const SizedBox(height: 8),
                      // Distance + earnings
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            trip.itemCount,
                            style: GoogleFonts.dmSans(
                              fontSize: 11,
                              color:
                                  TruxifyColors.adaptiveSecondaryText(context),
                            ),
                          ),
                          Text(
                            trip.earnings,
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
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRouteMap(List<Map<String, dynamic>> routePoints) {
    if (routePoints.isEmpty) {
      return Container(
        decoration: BoxDecoration(
          color: TruxifyColors.subtleBorder,
          borderRadius: BorderRadius.circular(8),
        ),
        child: const Center(
          child: Icon(Icons.map_outlined, color: Colors.grey),
        ),
      );
    }

    final points = routePoints.map((point) {
      return ll.LatLng(
        (point['latitude'] as num).toDouble(),
        (point['longitude'] as num).toDouble(),
      );
    }).toList();

    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: FlutterMap(
        options: MapOptions(
          initialCenter: points.first,
          initialZoom: 6.0,
          interactionOptions: const InteractionOptions(
            flags: InteractiveFlag.none,
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
                points: points,
                strokeWidth: 4,
                color: TruxifyColors.accent,
              ),
            ],
          ),
          MarkerLayer(
            markers: routePoints.where((p) =>
              p == routePoints.first ||
              p == routePoints.last ||
              p['is_claimed'] == true
            ).map((point) {
              return Marker(
                point: ll.LatLng(
                  (point['latitude'] as num).toDouble(),
                  (point['longitude'] as num).toDouble(),
                ),
                width: 12,
                height: 12,
                onTap: () {
                  final mapPoint = RouteMapPoint(
                    id: point['id']?.toString() ?? '',
                    title: (point['label'] ?? point['title'] ?? 'Stop').toString(),
                    subtitle: (point['address'] ?? point['subtitle'] ?? '').toString(),
                    details: (point['details'] ?? '').toString(),
                    progress: (point['progress'] as num?)?.toDouble() ?? 0.0,
                    claimed: point['is_claimed'] == true,
                    icon: Icons.place,
                    latitude: (point['latitude'] as num).toDouble(),
                    longitude: (point['longitude'] as num).toDouble(),
                    loadOfferId: point['load_offer_id']?.toString(),
                  );
                  Navigator.of(context).pushNamed(
                    AppRoutes.loadPointDetail,
                    arguments: mapPoint,
                  );
                },
                child: Container(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: point['is_claimed'] == true
                        ? TruxifyColors.success
                        : TruxifyColors.accent,
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}

class _TopTabToggle extends StatelessWidget {
  const _TopTabToggle({required this.index, required this.onChanged});

  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    Widget chip(String label, int value) {
      final selected = index == value;
      return InkWell(
        onTap: () => onChanged(value),
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: selected ? TruxifyColors.accentLight : Colors.transparent,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: TruxifyColors.border),
          ),
          child: Text(
            label,
            style: GoogleFonts.dmSans(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: Theme.of(context).brightness == Brightness.dark
                  ? (selected ? TruxifyColors.accentDark : TruxifyColors.strongBorder)
                  : (selected ? TruxifyColors.accentDark : TruxifyColors.primaryText),
            ),
          ),
        ),
      );
    }

    return Row(
      children: [
        chip(AppLocalizations.of(context)!.trips, 0),
        const SizedBox(width: 8),
        chip(AppLocalizations.of(context)!.marketplace, 1),
      ],
    );
  }
}

class _MarketplaceBody extends StatelessWidget {
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

  final bool loading;
  final String? error;
  final List<LoadOffer> standardLoads;
  final List<LoadOffer> enRouteLoads;
  final Map<String, DriverBid> bidsByLoadId;
  final Set<String> submittingLoadIds;
  final ValueChanged<LoadOffer> onOpenLoad;
  final Future<void> Function(LoadOffer load, num amount) onSubmitBid;

  @override
  Widget build(BuildContext context) {
    if (loading && standardLoads.isEmpty && enRouteLoads.isEmpty) {
      return ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: 3,
        itemBuilder: (context, index) => const ShimmerLoadCard(),
      );
    }

    if (error != null && standardLoads.isEmpty && enRouteLoads.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(AppLocalizations.of(context)!.couldNotLoadMarketplace,
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                Text(error!, style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 14),
                Text(AppLocalizations.of(context)!.couldNotLoadMarketplace,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6),
                    )),
              ],
            ),
          ),
        ],
      );
    }

    if (standardLoads.isEmpty && enRouteLoads.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          SizedBox(height: 80),
          Center(child: Text(AppLocalizations.of(context)!.noLoadsAvailable)),
        ],
      );
    }

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
      children: [
        if (enRouteLoads.isNotEmpty) ...[
          SectionHeader(
            title: AppLocalizations.of(context)!.enRouteOpportunities,
            subtitle: AppLocalizations.of(context)!.pickupNearbyLoads,
          ),
          const SizedBox(height: 10),
          ...enRouteLoads.map(
            (load) => _LoadOfferCard(
              load: load,
              bid: bidsByLoadId[load.id],
              isSubmitting: submittingLoadIds.contains(load.id),
              onOpen: () => onOpenLoad(load),
              onBid: (amount) => onSubmitBid(load, amount),
            ),
          ),
          const SizedBox(height: 16),
        ],
        if (standardLoads.isNotEmpty) ...[
          SectionHeader(
            title: AppLocalizations.of(context)!.marketplaceLoads,
            subtitle: AppLocalizations.of(context)!.availableLoadsYouCanBidFor,
          ),
          const SizedBox(height: 10),
          ...standardLoads.map(
            (load) => _LoadOfferCard(
              load: load,
              bid: bidsByLoadId[load.id],
              isSubmitting: submittingLoadIds.contains(load.id),
              onOpen: () => onOpenLoad(load),
              onBid: (amount) => onSubmitBid(load, amount),
            ),
          ),
        ],
        if (error != null) ...[
          const SizedBox(height: 14),
          Text(
            'Some data may be out of date. Last error: $error',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: TruxifyColors.secondaryText),
          ),
        ],
      ],
    );
  }
}

class _LoadOfferCard extends StatelessWidget {
  const _LoadOfferCard({
    required this.load,
    required this.bid,
    required this.isSubmitting,
    required this.onOpen,
    required this.onBid,
  });

  final LoadOffer load;
  final DriverBid? bid;
  final bool isSubmitting;
  final VoidCallback onOpen;
  final Future<void> Function(num amount) onBid;

  StatusPill _pillFor(BidStatus status) {
    switch (status) {
      case BidStatus.accepted:
        return const StatusPill(
            label: 'Accepted',
            backgroundColor: TruxifyColors.successLight,
            foregroundColor: TruxifyColors.success);
      case BidStatus.rejected:
        return const StatusPill(
            label: 'Rejected',
            backgroundColor: TruxifyColors.errorLight,
            foregroundColor: TruxifyColors.error);
      case BidStatus.pending:
        return const StatusPill(
            label: 'Pending',
            backgroundColor: TruxifyColors.warningLight,
            foregroundColor: TruxifyColors.warning);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppCard(
      margin: const EdgeInsets.only(bottom: 12),
      onTap: onOpen,
      elevation: 2,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      load.route,
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    if (load.routeSubtitle.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(load.routeSubtitle,
                          style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ],
                ),
              ),
              if (bid != null) _pillFor(bid!.status),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 10,
            runSpacing: 6,
            children: [
              _MetaChip(icon: Icons.inventory_2_rounded, label: load.goods),
              _MetaChip(icon: Icons.scale_rounded, label: load.weight),
              _MetaChip(
                  icon: Icons.account_balance_wallet_rounded,
                  label: load.freightValue),
              _MetaChip(
                  icon: Icons.trending_up_rounded, label: load.estimatedProfit),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Est. profit: ${load.netProfit}',
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
              TextButton(
                onPressed: isSubmitting
                    ? null
                    : () async {
                        final result = await showModalBottomSheet<num>(
                          context: context,
                          isScrollControlled: true,
                          backgroundColor: TruxifyColors.cardBackground,
                          shape: const RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.vertical(top: Radius.circular(24)),
                          ),
                          builder: (_) =>
                              _BidBottomSheet(load: load, existingBid: bid),
                        );
                        if (result != null) await onBid(result);
                      },
                style:
                    TextButton.styleFrom(foregroundColor: TruxifyColors.accent),
                child: Text(isSubmitting
                    ? 'Submitting...'
                    : (bid == null ? 'Bid' : 'Update bid')),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: TruxifyColors.secondaryBackground,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: TruxifyColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: TruxifyColors.secondaryText),
          const SizedBox(width: 6),
          Text(
            label,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: TruxifyColors.primaryText),
          ),
        ],
      ),
    );
  }
}

class _BidBottomSheet extends StatefulWidget {
  const _BidBottomSheet({required this.load, required this.existingBid});

  final LoadOffer load;
  final DriverBid? existingBid;

  @override
  State<_BidBottomSheet> createState() => _BidBottomSheetState();
}

class _BidBottomSheetState extends State<_BidBottomSheet> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.existingBid?.amount.toString(),
  );
  String? _error;
  bool _submitting = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final raw = _controller.text.trim();
    final amount = num.tryParse(raw);
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a valid bid amount.');
      return;
    }
    setState(() {
      _error = null;
      _submitting = true;
    });
    Navigator.of(context).pop(amount);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
          20, 10, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const BottomSheetHandle(),
          const SizedBox(height: 16),
          Text(
            'Submit bid',
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            widget.load.route,
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: TruxifyColors.secondaryText),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _controller,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              labelText: 'Bid amount',
              hintText: 'e.g. 25000',
              errorText: _error,
            ),
          ),
          const SizedBox(height: 16),
          PrimaryButton(
            label: _submitting ? 'Submitting...' : 'Submit',
            onPressed: _submitting ? null : _submit,
          ),
          const SizedBox(height: 8),
          TextActionButton(
            label: 'Cancel',
            onPressed: _submitting ? null : () => Navigator.of(context).pop(),
            color: TruxifyColors.secondaryText,
          ),
        ],
      ),
    );
  }
}

class _OfflineTripsBanner extends StatelessWidget {
  const _OfflineTripsBanner({required this.savedAt});

  final DateTime? savedAt;

  String _formatSavedAt(DateTime time) {
    final now = DateTime.now();
    final diff = now.difference(time);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final label = savedAt != null
        ? 'Offline mode — showing trips saved ${_formatSavedAt(savedAt!)}'
        : 'Offline mode — showing your last saved trips';

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: isDark
            ? TruxifyColors.darkSecondaryBackground
            : TruxifyColors.errorLight,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isDark ? TruxifyColors.darkBorder : TruxifyColors.border,
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.cloud_off_rounded,
              size: 18, color: TruxifyColors.adaptiveSecondaryText(context)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: GoogleFonts.dmSans(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: TruxifyColors.adaptiveSecondaryText(context),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
