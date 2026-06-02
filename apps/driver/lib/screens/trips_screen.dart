import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' as ll;
import '../core/app_routes.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../data/mock_data.dart';
import '../widgets/common_widgets.dart';
import '../services/trip_service.dart';

class TripsScreen extends StatefulWidget {
  const TripsScreen({super.key});

  @override
  State<TripsScreen> createState() => _TripsScreenState();
}

class _TripsScreenState extends State<TripsScreen> {
  late final TripService _tripService;

  List<Map<String, dynamic>> _trips = [];
  Map<String, List<Map<String, dynamic>>> _tripStopsByTripId = {};
  Map<String, List<Map<String, dynamic>>> _routePointsByTripId = {};

  bool _isLoadingTrips = true;
  int _selectedChipIndex = 0;
  int _selectedSortIndex = 0;

  // 0: Newest, 1: Oldest, 2: Highest, 3: Lowest, 4: By status

  final List<String> _statusFilters = [
    'All',
    'Active',
    'Completed',
    'Cancelled'
  ];

  @override
  void initState() {
    super.initState();
    _tripService = TripService();
    _loadTrips();
  }

  Future<void> _loadTrips() async {
    try {
      final trips = await _tripService.fetchTrips();

      final stopsByTrip = <String, List<Map<String, dynamic>>>{};
      final routePointsByTrip = <String, List<Map<String, dynamic>>>{};

      await Future.wait(trips.map((trip) async {
        final tripId = trip['trip_display_id'].toString();
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
      debugPrint("Failed to load trips: $e");
      if (!mounted) return;
      setState(() {
        _isLoadingTrips = false;
      });
    }
  }

  Future<void> _completeCurrentStop(String tripId) async {
    final stops = _tripStopsByTripId[tripId] ?? [];
    final currentStop = stops.firstWhere(
      (stop) => stop['is_current'] == true,
      orElse: () => {},
    );

    if (currentStop.isEmpty) {
      return;
    }

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
      case 0: // Newest first (Keep original list order since mock is ordered newest first)
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
      case 4: // By status (Active first, then Completed, then Cancelled)
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
                        setState(() {
                          _selectedSortIndex = tempSortIndex;
                        });
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
    final allTrips = _trips.isNotEmpty
        ? _mapSupabaseTripsToUiTrips()
        : _getFilteredAndSortedTrips();

    final trips = _selectedChipIndex == 0
        ? allTrips
        : allTrips
            .where((trip) =>
                trip.status == _getStatusFromIndex(_selectedChipIndex))
            .toList();
    debugPrint('Supabase trips count: ${_trips.length}');

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
                  Text(
                    'My Trips',
                    style: GoogleFonts.dmSans(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
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
                  ),
                ],
              ),
            ),
            Container(height: 1, color: TruxifyColors.border),

            // Summary Strip
            Container(
              color: Theme.of(context).colorScheme.surface,
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      children: [
                        Text(
                          '24',
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
                            color: TruxifyColors.adaptiveSecondaryText(context),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Container(width: 1, height: 32, color: TruxifyColors.border),
                  Expanded(
                    child: Column(
                      children: [
                        Text(
                          '₹1.2L',
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
                            color: TruxifyColors.adaptiveSecondaryText(context),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Container(width: 1, height: 32, color: TruxifyColors.border),
                  Expanded(
                    child: Column(
                      children: [
                        Text(
                          '97%',
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
                            color: TruxifyColors.adaptiveSecondaryText(context),
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
                    onTap: () {
                      setState(() {
                        _selectedChipIndex = index;
                      });
                    },
                    child: Container(
                      margin: const EdgeInsets.only(right: 8),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 6),
                      decoration: BoxDecoration(
                        color: isSelected ? TruxifyColors.accent : Colors.white,
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
                                : TruxifyColors.adaptiveSecondaryText(context),
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
              child: trips.isEmpty
                  ? Center(
                      child: Text(
                        'No trips found',
                        style: GoogleFonts.dmSans(
                          color: TruxifyColors.adaptiveSecondaryText(context),
                          fontSize: 14,
                        ),
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.all(12),
                      itemCount: trips.length,
                      itemBuilder: (context, index) {
                        final trip = trips[index];
                        return _buildTripCard(context, trip);
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLiveStopsPreview(String tripId) {
    final stops = _tripStopsByTripId[tripId] ?? [];
    if (stops.isEmpty) {
      return const SizedBox.shrink();
    }

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
              '${isCompleted ? "✅" : isCurrent ? "🔄" : "⏳"} ${stop['customer_name']} → ${stop['drop_location']}',
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
      onTap: () {
        Navigator.pushNamed(
          context,
          AppRoutes.tripDetail,
          arguments: trip,
        );
      },
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
                height: 120, // Approximate height matching card content
                color: statusColor,
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(14.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Small route thumbnail (OSM)
                      SizedBox(
                        height: 86,
                        child: _buildRouteMap(routePoints),
                      ),
                      const SizedBox(height: 8),
                      _buildLiveStopsPreview(trip.tripId),
                      const SizedBox(height: 8),
                      // Top Row
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
                      // Date Row
                      Text(
                        trip.date,
                        style: GoogleFonts.dmSans(
                          fontSize: 11,
                          color: TruxifyColors.adaptiveSecondaryText(context),
                        ),
                      ),
                      const SizedBox(height: 8),
                      // Items Row
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
                      // Bottom Row
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
