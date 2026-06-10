import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' as ll;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../core/app_routes.dart';
import '../core/driver_session.dart';
import '../core/supabase_config.dart';
import '../models/app_models.dart';
import '../models/marketplace_models.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import '../services/marketplace_repository.dart';
import '../services/trip_service.dart';

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
  late final TripService _tripService;

  List<Map<String, dynamic>> _trips = [];
  Map<String, List<Map<String, dynamic>>> _tripStopsByTripId = {};
  Map<String, List<Map<String, dynamic>>> _routePointsByTripId = {};

  bool _isLoadingTrips = true;
  String? _tripsError;

  bool _marketplaceLoading = false;
  String? _marketplaceError;
  List<LoadOffer> _marketplaceLoads = const [];
  List<LoadOffer> _enRouteLoads = const [];
  Map<String, DriverBid> _bidsByLoadId = const {};

  final List<String> _statusFilters = [
    'All',
    'Active',
    'Completed',
    'Cancelled',
  ];

  @override
  void initState() {
    super.initState();
    _tripService = TripService();
    _loadTrips();
    if (SupabaseConfig.isConfigured) {
      _refreshMarketplace();
      _subscribeToRealtime();
    } else {
      _marketplaceError =
          'Supabase is not configured. Pass --dart-define=SUPABASE_URL=... and --dart-define=SUPABASE_ANON_KEY=...';
    }
  }

  Future<void> _loadTrips() async {
    setState(() {
      _isLoadingTrips = true;
      _tripsError = null;
    });

    try {
      final trips = await _tripService.fetchTrips();

      final stopsByTrip = <String, List<Map<String, dynamic>>>{};
      final routePointsByTrip = <String, List<Map<String, dynamic>>>{};

      await Future.wait(trips.map((trip) async {
        final tripId = trip['trip_display_id']?.toString();
        if (tripId == null || tripId.isEmpty) return;

        final results = await Future.wait([
          _tripService.fetchTripStops(tripId),
          _tripService.fetchRouteMapPoints(tripId),
        ]);
        stopsByTrip[tripId] = results[0];
        routePointsByTrip[tripId] = results[1];
      }));

      if (!mounted) return;

      setState(() {
        _trips = trips;
        _tripStopsByTripId = stopsByTrip;
        _routePointsByTripId = routePointsByTrip;
        _isLoadingTrips = false;
      });
    } catch (e) {
      debugPrint('Failed to load trips: $e');
      if (!mounted) return;
      setState(() {
        _isLoadingTrips = false;
        _tripsError = e.toString();
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

    await _tripService.markStopCompleted(
      currentStop['id'].toString(),
      currentStop['trip_display_id'].toString(),
    );
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
      return Trip(
        route: row['route_label']?.toString() ?? 'Unknown route',
        date: row['trip_date']?.toString() ?? '',
        items: const [],
        itemCount: row['distance']?.toString() ?? '',
        distance: row['distance']?.toString() ?? '',
        earnings: '₹${((row['net_earnings'] ?? 0) / 100).toStringAsFixed(0)}',
        status: _mapStatus(row['status']?.toString()),
        tripId: row['trip_display_id']?.toString() ?? '',
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
              '₹${((row['net_earnings'] ?? 0) / 100).toStringAsFixed(0)}',
        ),
        tripItems: const [],
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
        _marketplaceRepository.fetchDriverBids(
            driverId: DriverSession.driverId),
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

  @override
  void dispose() {
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
                    'Sort Trips',
                    style: GoogleFonts.dmSans(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 20),
                  _buildSortOption(context, 'Newest first', 0, tempSortIndex,
                      (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(context, 'Oldest first', 1, tempSortIndex,
                      (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(
                      context, 'Highest earnings', 2, tempSortIndex, (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(context, 'Lowest earnings', 3, tempSortIndex,
                      (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(context, 'By status', 4, tempSortIndex,
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
                        'Apply',
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
                color: Theme.of(context).colorScheme.onSurface,
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
                        _topTabIndex == 0 ? 'My Trips' : 'Marketplace',
                        style: GoogleFonts.dmSans(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: TruxifyColors.primaryText,
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
                    onOpenLoad: (load) => Navigator.of(context)
                        .pushNamed(AppRoutes.loadDetail, arguments: load),
                    onSubmitBid: (load, amount) async {
                      final loadId = load.id;
                      if (loadId.isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                              content: Text('This load is missing an id.')),
                        );
                        return;
                      }
                      try {
                        final bid = await _marketplaceRepository.submitBid(
                          loadId: loadId,
                          driverId: DriverSession.driverId,
                          amount: amount,
                        );
                        if (!context.mounted) return;
                        setState(() {
                          _bidsByLoadId = <String, DriverBid>{
                            ..._bidsByLoadId,
                            bid.loadId: bid,
                          };
                        });
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                              content: Text('Bid submitted (Pending).')),
                        );
                      } catch (e) {
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Failed to submit bid: $e')),
                        );
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
                            'Total trips',
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
                            'Total earned',
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
                            'Completion',
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
                          color:
                              isSelected ? TruxifyColors.accent : Colors.white,
                          border: Border.all(
                            color: isSelected
                                ? TruxifyColors.accent
                                : TruxifyColors.border,
                          ),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Center(
                          child: Text(
                            _statusFilters[index],
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

              // Trips List
              Expanded(
                child: RefreshIndicator(
                  color: TruxifyColors.accent,
                  onRefresh: _loadTrips,
                  child: _isLoadingTrips
                      ? const Center(child: CircularProgressIndicator())
                      : _tripsError != null
                          ? ListView(
                              physics: const AlwaysScrollableScrollPhysics(),
                              padding: const EdgeInsets.all(16),
                              children: [
                                const SizedBox(height: 40),
                                Center(
                                  child: Text(
                                    'Failed to load trips.\nPull down to retry.',
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
                          : trips.isEmpty
                              ? ListView(
                                  physics:
                                      const AlwaysScrollableScrollPhysics(),
                                  children: [
                                    const SizedBox(height: 80),
                                    Center(
                                      child: Text(
                                        'No trips found',
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
                                  physics:
                                      const AlwaysScrollableScrollPhysics(),
                                  padding: const EdgeInsets.all(12),
                                  itemCount: trips.length,
                                  itemBuilder: (context, index) =>
                                      _buildTripCard(context, trips[index]),
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
              child: const Text('Mark Current Stop Completed'),
            ),
          ),
        const SizedBox(height: 10),
        Text(
          'Delivery Stops',
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
        statusLabel = 'Active';
        break;
      case TripStatusType.completed:
        statusColor = TruxifyColors.success;
        statusBgColor = const Color(0xFFE8F5E9);
        statusLabel = 'Completed';
        break;
      case TripStatusType.cancelled:
        statusColor = TruxifyColors.errorRed;
        statusBgColor = TruxifyColors.errorLight;
        statusLabel = 'Cancelled';
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
              color: TruxifyColors.accent.withOpacity(0.06),
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
                                          : const Color(0xFFFDEAEA),
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
          color: const Color(0xFFF0E8E8),
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
            markers: routePoints.map((point) {
              return Marker(
                point: ll.LatLng(
                  (point['latitude'] as num).toDouble(),
                  (point['longitude'] as num).toDouble(),
                ),
                width: 12,
                height: 12,
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
              color: selected
                  ? TruxifyColors.accentDark
                  : TruxifyColors.secondaryText,
            ),
          ),
        ),
      );
    }

    return Row(
      children: [
        chip('Trips', 0),
        const SizedBox(width: 8),
        chip('Loads', 1),
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
    required this.onOpenLoad,
    required this.onSubmitBid,
  });

  final bool loading;
  final String? error;
  final List<LoadOffer> standardLoads;
  final List<LoadOffer> enRouteLoads;
  final Map<String, DriverBid> bidsByLoadId;
  final ValueChanged<LoadOffer> onOpenLoad;
  final Future<void> Function(LoadOffer load, num amount) onSubmitBid;

  @override
  Widget build(BuildContext context) {
    if (loading && standardLoads.isEmpty && enRouteLoads.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: const [
          SizedBox(height: 120),
          Center(child: CircularProgressIndicator()),
        ],
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
                Text('Could not load marketplace',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                Text(error!, style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 14),
                const OutlinedAccentButton(
                  label: 'Pull to refresh',
                  onPressed: null,
                ),
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
        children: const [
          SizedBox(height: 80),
          Center(child: Text('No loads available right now. Pull to refresh.')),
        ],
      );
    }

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
      children: [
        if (enRouteLoads.isNotEmpty) ...[
          const SectionHeader(
            title: 'En-route opportunities',
            subtitle: 'Pick up nearby loads with minimal detours',
          ),
          const SizedBox(height: 10),
          ...enRouteLoads.map(
            (load) => _LoadOfferCard(
              load: load,
              bid: bidsByLoadId[load.id],
              onOpen: () => onOpenLoad(load),
              onBid: (amount) => onSubmitBid(load, amount),
            ),
          ),
          const SizedBox(height: 16),
        ],
        if (standardLoads.isNotEmpty) ...[
          const SectionHeader(
            title: 'Marketplace loads',
            subtitle: 'Available loads you can bid for',
          ),
          const SizedBox(height: 10),
          ...standardLoads.map(
            (load) => _LoadOfferCard(
              load: load,
              bid: bidsByLoadId[load.id],
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
    required this.onOpen,
    required this.onBid,
  });

  final LoadOffer load;
  final DriverBid? bid;
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
                onPressed: () async {
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
                child: Text(bid == null ? 'Bid' : 'Update bid'),
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
