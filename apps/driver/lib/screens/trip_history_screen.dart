import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../data/mock_data.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class TripHistoryScreen extends StatefulWidget {
  const TripHistoryScreen({super.key});

  @override
  State<TripHistoryScreen> createState() => _TripHistoryScreenState();
}

class _TripHistoryScreenState extends State<TripHistoryScreen> {
  int _filterIndex = 0; // 0 = All, 1 = Completed, 2 = Cancelled

  List<TripRecord> get _visibleTrips {
    switch (_filterIndex) {
      case 1:
        return tripHistory.where((trip) => trip.completed).toList();
      case 2:
        return tripHistory.where((trip) => !trip.completed).toList();
      default:
        return tripHistory;
    }
  }

  String get _summaryLabel {
    switch (_filterIndex) {
      case 1:
        return 'Completed trips';
      case 2:
        return 'Cancelled trips';
      default:
        return 'All trip records';
    }
  }

  Future<void> _showReceiptSheet(TripRecord trip) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const BottomSheetHandle(),
              const SizedBox(height: 16),
              Center(
                child: Text(
                  'TRIP RECEIPT',
                  style: GoogleFonts.dmSans(
                    fontSize: 13,
                    letterSpacing: 1.5,
                    fontWeight: FontWeight.bold,
                    color: TruxifyColors.hintText,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: TruxifyColors.secondaryBackground,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: TruxifyColors.border),
                ),
                child: Column(
                  children: [
                    _ReceiptLine(label: 'Trip Reference', value: trip.tripId, isMonospace: true),
                    const Divider(height: 16, color: TruxifyColors.border),
                    _ReceiptLine(label: 'Carrier Route', value: trip.route),
                    const Divider(height: 16, color: TruxifyColors.border),
                    _ReceiptLine(label: 'Completed On', value: trip.date),
                    const Divider(height: 16, color: TruxifyColors.border),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Total Paid',
                          style: GoogleFonts.dmSans(fontSize: 13, fontWeight: FontWeight.bold, color: TruxifyColors.primaryText),
                        ),
                        Text(
                          trip.earnings,
                          style: GoogleFonts.dmSans(fontSize: 16, fontWeight: FontWeight.bold, color: TruxifyColors.accentDark),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: TruxifyColors.accentLight,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: TruxifyColors.accent.withOpacity(0.2)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.shield_outlined, color: TruxifyColors.accentDark, size: 20),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            trip.verifiedBadge,
                            style: GoogleFonts.dmSans(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: TruxifyColors.accentDark,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Hash: ${trip.hash.substring(0, 18)}...',
                            style: GoogleFonts.robotoMono(
                              fontSize: 10,
                              color: TruxifyColors.accentDark.withOpacity(0.7),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        side: const BorderSide(color: TruxifyColors.border),
                      ),
                      onPressed: () {
                        Navigator.pop(context);
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Downloading receipt PDF...'),
                            backgroundColor: TruxifyColors.success,
                          ),
                        );
                      },
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.download_rounded, size: 16, color: TruxifyColors.secondaryText),
                          const SizedBox(width: 6),
                          Text(
                            'PDF',
                            style: GoogleFonts.dmSans(
                              fontWeight: FontWeight.bold,
                              color: TruxifyColors.secondaryText,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: PrimaryButton(
                      label: 'Done',
                      onPressed: () => Navigator.pop(context),
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: TruxifyColors.background,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: TruxifyColors.primaryText),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          'Trip History Log',
          style: GoogleFonts.dmSans(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: TruxifyColors.primaryText,
          ),
        ),
        shape: const Border(bottom: BorderSide(color: TruxifyColors.border)),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          children: [
            // Filter chips
            Row(
              children: [
                _buildFilterChip(0, 'All Trips'),
                const SizedBox(width: 8),
                _buildFilterChip(1, 'Completed'),
                const SizedBox(width: 8),
                _buildFilterChip(2, 'Cancelled'),
              ],
            ),
            const SizedBox(height: 16),

            // Statistics hub
            AppCard(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
              child: Row(
                children: [
                  Expanded(
                    child: _MetricColumn(
                      label: 'Total Paid',
                      value: '₹1,24,800',
                    ),
                  ),
                  Container(width: 1, height: 32, color: TruxifyColors.border),
                  Expanded(
                    child: _MetricColumn(
                      label: 'Total Trips',
                      value: '142',
                    ),
                  ),
                  Container(width: 1, height: 32, color: TruxifyColors.border),
                  Expanded(
                    child: _MetricColumn(
                      label: 'Avg Earnings',
                      value: '₹879',
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Results count
            Text(
              '${_visibleTrips.length} records found · $_summaryLabel',
              style: GoogleFonts.dmSans(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: TruxifyColors.secondaryText,
              ),
            ),
            const SizedBox(height: 10),

            // Records List
            ..._visibleTrips.map((trip) {
              final isCompleted = trip.completed;
              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: TruxifyColors.border),
                    boxShadow: [
                      BoxShadow(
                        color: TruxifyColors.accent.withOpacity(0.04),
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
                          height: 120, // Approximate card height
                          color: isCompleted ? TruxifyColors.success : TruxifyColors.warning,
                        ),
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.all(14),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
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
                                    Text(
                                      trip.earnings,
                                      style: GoogleFonts.dmSans(
                                        fontSize: 15,
                                        fontWeight: FontWeight.bold,
                                        color: TruxifyColors.primaryText,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  trip.date,
                                  style: GoogleFonts.dmSans(
                                    fontSize: 12,
                                    color: TruxifyColors.hintText,
                                  ),
                                ),
                                const SizedBox(height: 12),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: isCompleted ? TruxifyColors.success.withOpacity(0.1) : TruxifyColors.warning.withOpacity(0.1),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: Text(
                                        isCompleted ? 'Completed' : 'Cancelled',
                                        style: GoogleFonts.dmSans(
                                          fontSize: 10,
                                          fontWeight: FontWeight.bold,
                                          color: isCompleted ? TruxifyColors.success : TruxifyColors.warning,
                                        ),
                                      ),
                                    ),
                                    GestureDetector(
                                      onTap: () => _showReceiptSheet(trip),
                                      child: Row(
                                        children: [
                                          Text(
                                            'View Receipt',
                                            style: GoogleFonts.dmSans(
                                              fontSize: 12,
                                              fontWeight: FontWeight.bold,
                                              color: TruxifyColors.accent,
                                            ),
                                          ),
                                          const Icon(Icons.chevron_right_rounded, color: TruxifyColors.accent, size: 16),
                                        ],
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
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildFilterChip(int index, String label) {
    final isSelected = _filterIndex == index;
    return GestureDetector(
      onTap: () => setState(() => _filterIndex = index),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? TruxifyColors.accent : Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? TruxifyColors.accent : TruxifyColors.border,
          ),
        ),
        child: Text(
          label,
          style: GoogleFonts.dmSans(
            fontSize: 12,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
            color: isSelected ? Colors.white : TruxifyColors.secondaryText,
          ),
        ),
      ),
    );
  }
}

class _MetricColumn extends StatelessWidget {
  const _MetricColumn({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: GoogleFonts.dmSans(
            fontSize: 18,
            color: TruxifyColors.primaryText,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: GoogleFonts.dmSans(
            fontSize: 11,
            color: TruxifyColors.secondaryText,
          ),
        ),
      ],
    );
  }
}

class _ReceiptLine extends StatelessWidget {
  const _ReceiptLine({required this.label, required this.value, this.isMonospace = false});

  final String label;
  final String value;
  final bool isMonospace;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: GoogleFonts.dmSans(fontSize: 12, color: TruxifyColors.secondaryText),
          ),
          Text(
            value,
            style: isMonospace
                ? GoogleFonts.robotoMono(fontSize: 11, fontWeight: FontWeight.bold, color: TruxifyColors.primaryText)
                : GoogleFonts.dmSans(fontSize: 12, fontWeight: FontWeight.bold, color: TruxifyColors.primaryText),
          ),
        ],
      ),
    );
  }
}
