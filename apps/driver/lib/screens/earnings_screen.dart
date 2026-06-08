import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:truxify_driver/models/earnings_daily_model.dart';
import 'package:truxify_driver/services/driver_earnings_service.dart';
import '../theme/app_theme.dart';

class EarningsScreen extends StatefulWidget {
  const EarningsScreen({super.key});

  @override
  State<EarningsScreen> createState() => _EarningsScreenState();
}

class _EarningsScreenState extends State<EarningsScreen> {
  final DriverEarningsService _earningsService = DriverEarningsService();

  bool _isLoading = false;

  late DateTime _selectedDate;
  late int _currentYear;
  late int _currentMonth;

  Map<String, EarningsDailyModel> _earningsMap = {};
  List<Map<String, dynamic>> _selectedDayTrips = [];
  List<Map<String, dynamic>> _pendingPayments = [];

  @override
  void initState() {
    super.initState();
    _selectedDate = DateTime.now();
    _currentYear = _selectedDate.year;
    _currentMonth = _selectedDate.month;

    _loadAllData();
  }

  Future<void> _loadAllData() async {
    await Future.wait([
      _loadMonthlyEarnings(),
      _loadSelectedDayTrips(),
      _loadPendingPayments(),
    ]);
  }

  Future<void> _loadMonthlyEarnings() async {
    setState(() => _isLoading = true);

    try {
      final data = await _earningsService.fetchMonthlyEarnings(
        month: DateTime(_currentYear, _currentMonth),
      );

      if (!mounted) return;

      setState(() {
        _earningsMap = {
          for (final item in data)
            item['day_date'].toString(): EarningsDailyModel.fromMap(item),
        };
      });
    } catch (e) {
      debugPrint('Failed to load monthly earnings: $e');
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _loadSelectedDayTrips() async {
    try {
      final trips = await _earningsService.fetchCompletedTripsForDay(
        date: _selectedDate,
      );

      if (!mounted) return;

      setState(() {
        _selectedDayTrips = trips;
      });
    } catch (e) {
      debugPrint('Failed to load selected day trips: $e');
    }
  }

  Future<void> _loadPendingPayments() async {
    try {
      final transactions = await _earningsService.fetchWalletTransactions();

      if (!mounted) return;

      setState(() {
        _pendingPayments =
            transactions.where((txn) => txn['status'] == 'pending').toList();
      });
    } catch (e) {
      debugPrint('Failed to load pending payments: $e');
    }
  }

  String _getDateKey(DateTime date) {
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  }

  void _prevMonth() {
    setState(() {
      _currentMonth--;

      if (_currentMonth < 1) {
        _currentMonth = 12;
        _currentYear--;
      }
    });

    _loadMonthlyEarnings();
  }

  void _nextMonth() {
    setState(() {
      _currentMonth++;

      if (_currentMonth > 12) {
        _currentMonth = 1;
        _currentYear++;
      }
    });

    _loadMonthlyEarnings();
  }

  // Custom helper for formatting date: Thursday, 14 May 2026
  String _formatFullDate(DateTime date) {
    final weekdays = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday'
    ];
    final months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December'
    ];
    return '${weekdays[date.weekday - 1]}, ${date.day} ${months[date.month - 1]} ${date.year}';
  }

  String _getMonthYearLabel(int month, int year) {
    final months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December'
    ];
    return '${months[month - 1]} $year';
  }

  double get _todayAmount {
    final todayKey = _getDateKey(DateTime.now());
    return _earningsMap[todayKey]?.amount ?? 0.0;
  }

  double get _monthAmount {
    return _earningsMap.values.fold<double>(
      0,
      (sum, item) => sum + item.amount,
    );
  }

  double get _weekAmount {
    final now = DateTime.now();
    final startOfWeek = now.subtract(Duration(days: now.weekday - 1));

    return _earningsMap.entries.fold<double>(0, (sum, entry) {
      final date = DateTime.tryParse(entry.key);
      if (date == null) return sum;

      final isThisWeek =
          date.isAfter(startOfWeek.subtract(const Duration(days: 1))) &&
              date.isBefore(now.add(const Duration(days: 1)));

      return isThisWeek ? sum + entry.value.amount : sum;
    });
  }

  String _formatRupees(double amount) {
    return '₹${amount.toStringAsFixed(0)}';
  }

  String _tripRoute(Map<String, dynamic> trip) {
    return trip['route_label']?.toString() ?? 'Route unavailable';
  }

  String _tripCustomer(Map<String, dynamic> trip) {
    return trip['customer_name']?.toString() ??
        trip['customer_display_name']?.toString() ??
        'Customer';
  }

  double _tripAmount(Map<String, dynamic> trip) {
    final value = trip['net_earnings'] ?? trip['total_earnings'] ?? 0;
    if (value is num) return value / 100.0;

    return (double.tryParse(value.toString()) ?? 0.0) / 100.0;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        body: RefreshIndicator(
          onRefresh: _loadAllData,
          child: CustomScrollView(
            slivers: [
              // Premium App Bar
              SliverAppBar(
                backgroundColor: Theme.of(context).colorScheme.surface,
                pinned: true,
                elevation: 0,
                surfaceTintColor: Colors.transparent,
                title: Text(
                  'Earnings',
                  style: GoogleFonts.dmSans(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                ),
                bottom: PreferredSize(
                  preferredSize: const Size.fromHeight(1),
                  child: Container(
                    height: 1,
                    color: Theme.of(context).colorScheme.outlineVariant,
                  ),
                ),
              ),

              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  child: Column(
                    children: [
                      if (_isLoading) const LinearProgressIndicator(),
                      _buildOverallSummaryCards(),
                      const SizedBox(height: 24),
                      _buildHeatmapCalendarCard(),
                      const SizedBox(height: 24),
                      _buildSelectedDateDetailsCard(),
                      const SizedBox(height: 24),
                      _buildPendingPaymentsCard(),
                      const SizedBox(height: 40),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ));
  }

  Widget _buildOverallSummaryCards() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          _buildSummaryCard(
            value: _formatRupees(_todayAmount),
            label: 'Today',
            icon: Icons.today_rounded,
            iconColor: TruxifyColors.accent,
            bgColor: TruxifyColors.accentLight,
          ),
          const SizedBox(width: 12),
          _buildSummaryCard(
            value: _formatRupees(_weekAmount),
            label: 'This Week',
            icon: Icons.date_range_rounded,
            iconColor: TruxifyColors.warning,
            bgColor: TruxifyColors.warningLight,
          ),
          const SizedBox(width: 12),
          _buildSummaryCard(
            value: _formatRupees(_monthAmount),
            label: 'This Month',
            icon: Icons.calendar_month_rounded,
            iconColor: TruxifyColors.success,
            bgColor: TruxifyColors.successLight,
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryCard({
    required String value,
    required String label,
    required IconData icon,
    required Color iconColor,
    required Color bgColor,
  }) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
        decoration: BoxDecoration(
          color: Theme.of(context).cardTheme.color,
          borderRadius: BorderRadius.circular(16),
          border:
              Border.all(color: Theme.of(context).colorScheme.outlineVariant),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.01),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: bgColor,
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: iconColor, size: 20),
            ),
            const SizedBox(height: 12),
            Text(
              value,
              style: GoogleFonts.dmSans(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: Theme.of(context).colorScheme.onSurface,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: GoogleFonts.dmSans(
                fontSize: 11,
                color: TruxifyColors.adaptiveSecondaryText(context),
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeatmapCalendarCard() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    // Days in current selection
    final DateTime firstDay = DateTime(_currentYear, _currentMonth, 1);
    final int firstWeekday = firstDay.weekday; // 1 = Mon, 7 = Sun
    final int totalDays = DateTime(_currentYear, _currentMonth + 1, 0).day;
    final int leadingEmptyCells = firstWeekday - 1; // 0-indexed offset

    final int totalGridItems = leadingEmptyCells + totalDays;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        boxShadow: [
          BoxShadow(
            color: isDark
                ? Colors.black.withOpacity(0.25)
                : Colors.black.withOpacity(0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Earning Calendar',
                    style: GoogleFonts.dmSans(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Tap a date to inspect trips',
                    style: GoogleFonts.dmSans(
                      fontSize: 11,
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
                  ),
                ],
              ),
              // Month Switchers
              Row(
                children: [
                  IconButton(
                    onPressed: _prevMonth,
                    icon: const Icon(
                      Icons.chevron_left_rounded,
                      size: 20,
                      color: Colors.black,
                    ),
                    visualDensity: VisualDensity.compact,
                    style: IconButton.styleFrom(
                      backgroundColor: TruxifyColors.accentVeryLight,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    _getMonthYearLabel(_currentMonth, _currentYear),
                    style: GoogleFonts.dmSans(
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    onPressed: _nextMonth,
                    icon: const Icon(
                      Icons.chevron_right_rounded,
                      size: 20,
                      color: Colors.black,
                    ),
                    visualDensity: VisualDensity.compact,
                    style: IconButton.styleFrom(
                      backgroundColor: TruxifyColors.accentVeryLight,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 20),

          // Weekday Labels Row
          Row(
            children: ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label) {
              return Expanded(
                child: Center(
                  child: Text(
                    label,
                    style: GoogleFonts.dmSans(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 10),

          // Calendar Heatmap Grid
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: totalGridItems,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 7,
              mainAxisSpacing: 6,
              crossAxisSpacing: 6,
              childAspectRatio: 1.0,
            ),
            itemBuilder: (context, index) {
              if (index < leadingEmptyCells) {
                return const SizedBox.shrink();
              }

              final int day = index - leadingEmptyCells + 1;
              final DateTime cellDate =
                  DateTime(_currentYear, _currentMonth, day);
              final String cellKey = _getDateKey(cellDate);
              final bool isSelected = _getDateKey(_selectedDate) == cellKey;

              final earningData = _earningsMap[cellKey];
              final earnings = earningData?.amount ?? 0.0;

              // Determine color based on earnings magnitude relative to max ₹8,400
              Color cellBgColor = isDark
                  ? TruxifyColors.darkBorder.withOpacity(0.5)
                  : Theme.of(context)
                      .colorScheme
                      .outlineVariant
                      .withOpacity(0.3);
              Color textColor = Theme.of(context).colorScheme.onSurface;
              FontWeight textWeight = FontWeight.normal;

              if (earnings > 0) {
                final double scale = (earnings / 8400.0).clamp(0.0, 1.0);
                final double opacity = 0.15 + (scale * 0.75);
                cellBgColor = TruxifyColors.accent.withOpacity(opacity);

                if (opacity > 0.6) {
                  textColor = Colors.white;
                  textWeight = FontWeight.bold;
                } else {
                  textColor = isDark
                      ? TruxifyColors.darkPrimaryText
                      : TruxifyColors.accentDark;
                  textWeight = FontWeight.w600;
                }
              } else if (earningData != null && earnings == 0.0) {
                // Cancelled day (grey card outline style)
                cellBgColor = Theme.of(context)
                    .colorScheme
                    .outlineVariant
                    .withOpacity(0.6);
                textColor = TruxifyColors.adaptiveSecondaryText(context);
              }

              return GestureDetector(
                onTap: () {
                  setState(() => _selectedDate = cellDate);

                  _loadSelectedDayTrips();
                },
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  decoration: BoxDecoration(
                    color: cellBgColor,
                    borderRadius: BorderRadius.circular(8),
                    border: isSelected
                        ? Border.all(color: TruxifyColors.accent, width: 2)
                        : null,
                    boxShadow: isSelected
                        ? [
                            BoxShadow(
                              color: TruxifyColors.accent.withOpacity(0.3),
                              blurRadius: 6,
                              spreadRadius: 1,
                            ),
                          ]
                        : [],
                  ),
                  child: Center(
                    child: Text(
                      day.toString(),
                      style: GoogleFonts.dmSans(
                        fontSize: 12,
                        fontWeight: isSelected ? FontWeight.bold : textWeight,
                        color: isSelected
                            ? (earnings > 0 &&
                                    (0.15 + (earnings / 8400.0) * 0.75) > 0.6
                                ? Colors.white
                                : TruxifyColors.accent)
                            : textColor,
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: 16),

          // Heatmap Legend
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              Text(
                'Less',
                style: GoogleFonts.dmSans(
                  fontSize: 10,
                  color: TruxifyColors.adaptiveSecondaryText(context),
                ),
              ),
              const SizedBox(width: 4),
              _buildLegendBox(
                isDark
                    ? TruxifyColors.darkBorder.withOpacity(0.5)
                    : Theme.of(context)
                        .colorScheme
                        .outlineVariant
                        .withOpacity(0.3),
              ),
              const SizedBox(width: 2),
              _buildLegendBox(TruxifyColors.accent.withOpacity(0.2)),
              const SizedBox(width: 2),
              _buildLegendBox(TruxifyColors.accent.withOpacity(0.45)),
              const SizedBox(width: 2),
              _buildLegendBox(TruxifyColors.accent.withOpacity(0.7)),
              const SizedBox(width: 2),
              _buildLegendBox(TruxifyColors.accent),
              const SizedBox(width: 4),
              Text(
                'More',
                style: GoogleFonts.dmSans(
                  fontSize: 10,
                  color: TruxifyColors.adaptiveSecondaryText(context),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildLegendBox(Color color) {
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(2),
      ),
    );
  }

  Widget _buildSelectedDateDetailsCard() {
    final String dateKey = _getDateKey(_selectedDate);
    final earningData = _earningsMap[dateKey];
    final bool hasData = earningData != null;
    final double earnings = earningData?.amount ?? 0.0;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _formatFullDate(_selectedDate),
            style: GoogleFonts.dmSans(
              fontSize: 15,
              fontWeight: FontWeight.bold,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
          const SizedBox(height: 14),
          Divider(color: Theme.of(context).colorScheme.outlineVariant),
          const SizedBox(height: 14),
          Row(
            children: [
              _buildDailyMetric(
                label: 'EARNINGS',
                value: _formatRupees(earnings),
                icon: Icons.payments_outlined,
                color: TruxifyColors.accent,
              ),
              _buildDailyMetric(
                label: 'HOURS',
                value:
                    '${earningData?.hoursDriven.toStringAsFixed(1) ?? '0.0'}h',
                icon: Icons.timer_outlined,
                color: TruxifyColors.adaptiveSecondaryText(context),
              ),
              _buildDailyMetric(
                label: 'TRIPS',
                value: '${earningData?.tripCount ?? 0}',
                icon: Icons.local_shipping_outlined,
                color: TruxifyColors.success,
              ),
            ],
          ),
          const SizedBox(height: 24),
          if (!hasData)
            _buildEmptyMessage('No earnings found for this date.')
          else if (_selectedDayTrips.isEmpty)
            _buildEmptyMessage('No completed trips found for this date.')
          else ...[
            Text(
              'COMPLETED TRIPS',
              style: GoogleFonts.dmSans(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                color: TruxifyColors.adaptiveSecondaryText(context),
                letterSpacing: 1.0,
              ),
            ),
            const SizedBox(height: 10),
            ..._selectedDayTrips.map(_buildTripTile),
          ],
        ],
      ),
    );
  }

  Widget _buildTripTile(Map<String, dynamic> trip) {
    final amount = _tripAmount(trip);

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const Icon(
        Icons.check_circle_rounded,
        color: TruxifyColors.success,
      ),
      title: Text(_tripRoute(trip)),
      subtitle: Text(_tripCustomer(trip)),
      trailing: Text(
        _formatRupees(amount),
        style: GoogleFonts.dmSans(
          fontWeight: FontWeight.bold,
          color: TruxifyColors.accent,
        ),
      ),
    );
  }

  Widget _buildEmptyMessage(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Text(
          message,
          textAlign: TextAlign.center,
          style: GoogleFonts.dmSans(
            fontSize: 13,
            color: TruxifyColors.adaptiveSecondaryText(context),
          ),
        ),
      ),
    );
  }

  Widget _buildDailyMetric({
    required String label,
    required String value,
    required IconData icon,
    required Color color,
  }) {
    return Expanded(
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: color.withOpacity(0.7), size: 14),
              const SizedBox(width: 6),
              Text(
                label,
                style: GoogleFonts.dmSans(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: TruxifyColors.adaptiveSecondaryText(context),
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: GoogleFonts.dmSans(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPendingPaymentsCard() {
    final pendingAmount = _pendingPayments.fold<double>(0, (sum, item) {
      return sum + ((item['amount'] ?? 0) / 100.0);
    });

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Pending Payments',
                  style: GoogleFonts.dmSans(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                ),
              ),
              Text(
                _formatRupees(pendingAmount),
                style: GoogleFonts.dmSans(
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                  color: TruxifyColors.accent,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (_pendingPayments.isEmpty)
            _buildEmptyMessage('No pending payments.')
          else
            ..._pendingPayments.map((item) {
              final amount = ((item['amount'] ?? 0) / 100.0);

              return ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const CircleAvatar(
                  backgroundColor: TruxifyColors.accentVeryLight,
                  child: Icon(
                    Icons.account_balance_wallet_outlined,
                    color: TruxifyColors.accent,
                  ),
                ),
                title: Text(item['description'] ?? 'Pending payment'),
                subtitle: Text(item['trip_display_id'] ?? item['status'] ?? ''),
                trailing: Text(
                  _formatRupees(amount),
                  style: GoogleFonts.dmSans(fontWeight: FontWeight.bold),
                ),
              );
            }),
        ],
      ),
    );
  }
}
