import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../core/app_routes.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../data/mock_data.dart';
import '../widgets/common_widgets.dart';

class TripsScreen extends StatefulWidget {
  const TripsScreen({super.key});

  @override
  State<TripsScreen> createState() => _TripsScreenState();
}

class _TripsScreenState extends State<TripsScreen> {
  int _selectedChipIndex = 0; // 0: All, 1: Active, 2: Completed, 3: Cancelled
  int _selectedSortIndex = 0; // 0: Newest, 1: Oldest, 2: Highest, 3: Lowest, 4: By status

  final List<String> _statusFilters = ['All', 'Active', 'Completed', 'Cancelled'];

  List<Trip> _getFilteredAndSortedTrips() {
    List<Trip> trips = List.from(mockTrips);

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
        trips.sort((a, b) => _parseEarnings(b.earnings).compareTo(_parseEarnings(a.earnings)));
        break;
      case 3: // Lowest earnings
        trips.sort((a, b) => _parseEarnings(a.earnings).compareTo(_parseEarnings(b.earnings)));
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
      backgroundColor: Colors.white,
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
                      color: TruxifyColors.primaryText,
                    ),
                  ),
                  const SizedBox(height: 20),
                  _buildSortOption(context, 'Newest first', 0, tempSortIndex, (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(context, 'Oldest first', 1, tempSortIndex, (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(context, 'Highest earnings', 2, tempSortIndex, (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(context, 'Lowest earnings', 3, tempSortIndex, (idx) {
                    setBottomSheetState(() => tempSortIndex = idx);
                  }),
                  _buildSortOption(context, 'By status', 4, tempSortIndex, (idx) {
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
                          color: Colors.white,
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
                  color: isSelected ? TruxifyColors.accent : TruxifyColors.border,
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
                color: TruxifyColors.primaryText,
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
        backgroundColor: const Color(0xFFF7F3F3),
        body: Column(
          children: [
            // Top Bar
            Container(
              color: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'My Trips',
                    style: GoogleFonts.dmSans(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: TruxifyColors.primaryText,
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
              color: Colors.white,
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
                            color: TruxifyColors.hintText,
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
                            color: TruxifyColors.hintText,
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
                            color: TruxifyColors.hintText,
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
              color: Colors.white,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
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
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                      decoration: BoxDecoration(
                        color: isSelected ? TruxifyColors.accent : Colors.white,
                        border: Border.all(
                          color: isSelected ? TruxifyColors.accent : TruxifyColors.border,
                        ),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Center(
                        child: Text(
                          _statusFilters[index],
                          style: GoogleFonts.dmSans(
                            fontSize: 12,
                            fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                            color: isSelected ? Colors.white : TruxifyColors.hintText,
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
                          color: TruxifyColors.secondaryText,
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

  Widget _buildTripCard(BuildContext context, Trip trip) {
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
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: TruxifyColors.border),
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
                                color: TruxifyColors.primaryText,
                              ),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
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
                          color: TruxifyColors.hintText,
                        ),
                      ),
                      const SizedBox(height: 8),
                      // Items Row
                      trip.items.isEmpty
                          ? Text(
                              '—',
                              style: GoogleFonts.dmSans(
                                fontSize: 10,
                                color: TruxifyColors.hintText,
                              ),
                            )
                          : SingleChildScrollView(
                              scrollDirection: Axis.horizontal,
                              child: Row(
                                children: trip.items.map((item) {
                                  return Container(
                                    margin: const EdgeInsets.only(right: 6),
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFFDEAEA),
                                      border: Border.all(color: TruxifyColors.border),
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: Text(
                                      item,
                                      style: GoogleFonts.dmSans(
                                        fontSize: 10,
                                        color: TruxifyColors.accent,
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
                              color: TruxifyColors.hintText,
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
}
