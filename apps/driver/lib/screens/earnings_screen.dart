import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../data/mock_data.dart';
import '../widgets/common_widgets.dart';
import '../widgets/shimmer_loading.dart';
import '../widgets/status_badge.dart';
import '../services/earnings_data_service.dart';
import '../models/app_models.dart';

class EarningsScreen extends StatefulWidget {
  const EarningsScreen({super.key});

  @override
  State<EarningsScreen> createState() => _EarningsScreenState();
}

class _EarningsScreenState extends State<EarningsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  int _selectedBarIndex = 0;
  bool _isLoading = true;
  bool _hasError = false;
  String _errorMessage = '';
  List<EarningDay> _earningsData = [];
  EarningsStats? _stats;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this, initialIndex: 1);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        setState(() {
          _selectedBarIndex = 0;
          _isLoading = true;
          _hasError = false;
        });
        _loadData();
      }
    });
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  // ── Data Loading ────────────────────────────────────────────

  Future<void> _loadData() async {
    if (!mounted) return;
    setState(() {
      _isLoading = true;
      _hasError = false;
      _errorMessage = '';
    });
    try {
      // Vary delay by tab index to simulate period switching
      final delays = [
        const Duration(milliseconds: 400),
        const Duration(milliseconds: 600),
        const Duration(milliseconds: 800),
      ];
      final delay = delays[_tabController.index.clamp(0, delays.length - 1)];
      final data = await EarningsDataService.fetchWeeklyEarnings(delay: delay);
      if (!mounted) return;
      setState(() {
        _earningsData = data;
        _stats = EarningsDataService.computeStats(data);
        _isLoading = false;
        _selectedBarIndex = 0;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _hasError = true;
        _errorMessage = e.toString().replaceFirst('Exception: ', '');
        _isLoading = false;
      });
    }
  }

  Future<void> _handleRefresh() async {
    await _loadData();
  }

  // ── Helpers ──────────────────────────────────────────────────

  String _getFullDayName(String shortDay) {
    switch (shortDay) {
      case 'Mon':
        return 'Monday';
      case 'Tue':
        return 'Tuesday';
      case 'Wed':
        return 'Wednesday';
      case 'Thu':
        return 'Thursday';
      case 'Fri':
        return 'Friday';
      case 'Sat':
        return 'Saturday';
      case 'Sun':
        return 'Sunday';
      default:
        return shortDay;
    }
  }

  /// Format with Indian numbering (last 3, then groups of 2).
  String _formatAmount(int amount) {
    final s = amount.toString();
    if (s.length <= 3) return '₹$s';
    final lastThree = s.substring(s.length - 3);
    String rest = s.substring(0, s.length - 3);
    final groups = <String>[lastThree];
    while (rest.isNotEmpty) {
      if (rest.length <= 2) {
        groups.insert(0, rest);
        break;
      }
      groups.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    return '₹${groups.join(',')}';
  }

  // ── Computed ─────────────────────────────────────────────────

  double get _maxAmount => _earningsData.isEmpty
      ? 1
      : _earningsData
          .map((e) => e.amount.toDouble())
          .reduce((a, b) => a > b ? a : b);

  EarningDay? get _selectedEarning =>
      _selectedBarIndex < _earningsData.length
          ? _earningsData[_selectedBarIndex]
          : null;

  int get _totalPendingAmount {
    int total = 0;
    for (final p in pendingPayments) {
      final cleaned = p.amount.replaceAll(RegExp(r'[₹,\s]'), '');
      total += int.tryParse(cleaned) ?? 0;
    }
    return total;
  }

  // ── Build ────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: TruxifyColors.background,
      appBar: AppBar(
        title: const Text('Earnings'),
        actions: [
          IconButton(
            icon: const Icon(Icons.tune_rounded),
            onPressed: () {},
            tooltip: 'Filter period',
          ),
        ],
      ),
      body: Column(
        children: [
          // Period Selector TabBar
          Container(
            color: TruxifyColors.cardBackground,
            child: TabBar(
              controller: _tabController,
              labelColor: TruxifyColors.accent,
              unselectedLabelColor: TruxifyColors.hintText,
              indicatorColor: TruxifyColors.accent,
              indicatorWeight: 2,
              labelStyle: Theme.of(context)
                  .textTheme
                  .labelMedium
                  ?.copyWith(fontWeight: FontWeight.w600),
              unselectedLabelStyle: Theme.of(context).textTheme.labelMedium,
              tabs: const [
                Tab(
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.today_rounded, size: 16),
                      SizedBox(width: 8),
                      Text('Today'),
                    ],
                  ),
                ),
                Tab(
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.date_range_rounded, size: 16),
                      SizedBox(width: 8),
                      Text('This Week'),
                    ],
                  ),
                ),
                Tab(
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.calendar_month_rounded, size: 16),
                      SizedBox(width: 8),
                      Text('This Month'),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Content
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) return _buildLoadingState();
    if (_hasError) return _buildErrorState();
    if (_earningsData.isEmpty) return _buildEmptyState();
    return _buildContent();
  }

  // ── States ───────────────────────────────────────────────────

  Widget _buildLoadingState() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      child: Column(
        children: const [
          HeroShimmer(),
          SizedBox(height: 24),
          SectionShimmer(),
          SizedBox(height: 24),
          SectionShimmer(height: 160),
          SizedBox(height: 24),
          SectionShimmer(height: 200),
        ],
      ),
    );
  }

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.error_outline_rounded,
              size: 56,
              color: TruxifyColors.errorRed.withValues(alpha: 0.7),
            ),
            const SizedBox(height: 16),
            Text(
              'Oops!',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              _errorMessage.isNotEmpty
                  ? _errorMessage
                  : 'Something went wrong. Please try again.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: TruxifyColors.hintText,
                  ),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: () => _loadData(),
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: const Text('Try Again'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.bar_chart_rounded,
              size: 56,
              color: TruxifyColors.hintText.withValues(alpha: 0.5),
            ),
            const SizedBox(height: 16),
            Text(
              'No earnings data yet',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              'Complete your first trip to see your earnings here.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: TruxifyColors.hintText,
                  ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Main Content ─────────────────────────────────────────────

  Widget _buildContent() {
    final textTheme = Theme.of(context).textTheme;
    final reduceMotion = MediaQuery.of(context).disableAnimations;

    final body = SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      child: Column(
        children: [
          _AnimatedSection(
            delay: Duration.zero,
            reduceMotion: reduceMotion,
            child: _buildHeroCard(textTheme, reduceMotion),
          ),
          const SizedBox(height: 24),
          _AnimatedSection(
            delay: const Duration(milliseconds: 100),
            reduceMotion: reduceMotion,
            child:
                _buildEarningsChartCard(context, textTheme, reduceMotion),
          ),
          const SizedBox(height: 24),
          _AnimatedSection(
            delay: const Duration(milliseconds: 200),
            reduceMotion: reduceMotion,
            child: _buildBreakdownCard(textTheme),
          ),
          const SizedBox(height: 24),
          _AnimatedSection(
            delay: const Duration(milliseconds: 300),
            reduceMotion: reduceMotion,
            child: _buildSavingsCard(context, textTheme),
          ),
          const SizedBox(height: 24),
          _AnimatedSection(
            delay: const Duration(milliseconds: 400),
            reduceMotion: reduceMotion,
            child: _buildMilestonesCard(textTheme),
          ),
          const SizedBox(height: 24),
          _AnimatedSection(
            delay: const Duration(milliseconds: 500),
            reduceMotion: reduceMotion,
            child: _buildPendingPaymentsCard(textTheme),
          ),
        ],
      ),
    );

    return RefreshIndicator(
      onRefresh: _handleRefresh,
      color: TruxifyColors.accent,
      child: body,
    );
  }

  // ── 1. Hero Card ─────────────────────────────────────────────

  Widget _buildHeroCard(TextTheme textTheme, bool reduceMotion) {
    final stats = _stats;
    final totalAmount = stats?.totalAmount ?? 18400;
    final totalTrips = stats?.totalTrips ?? 8;
    final avgPerTrip = stats?.avgPerTrip ?? 2300;
    final totalHours = stats?.totalHours ?? 40;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [TruxifyColors.accent, TruxifyColors.accentDark],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: TruxifyColors.accent.withValues(alpha: 0.2),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'TOTAL EARNED',
            style: textTheme.labelSmall?.copyWith(
              color: Colors.white.withValues(alpha: 0.6),
              fontWeight: FontWeight.bold,
              letterSpacing: 1.0,
            ),
          ),
          const SizedBox(height: 8),
          // Count-up animation
          reduceMotion
              ? Text(
                  _formatAmount(totalAmount),
                  style: textTheme.displaySmall?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                )
              : TweenAnimationBuilder<int>(
                  tween: IntTween(begin: 0, end: totalAmount),
                  duration: const Duration(milliseconds: 800),
                  curve: const Cubic(0.0, 0.0, 0.2, 1.0),
                  builder: (context, value, child) {
                    return Text(
                      _formatAmount(value),
                      style: textTheme.displaySmall?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    );
                  },
                ),
          const SizedBox(height: 12),
          // Goal progress animation
          if (reduceMotion) ...[
            Container(
              height: 6,
              width: double.infinity,
              decoration: BoxDecoration(
                color: TruxifyColors.accent.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(3),
              ),
              child: FractionallySizedBox(
                alignment: Alignment.centerLeft,
                widthFactor: 0.74,
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),
            ),
          ] else
            TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: 0.74),
              duration: const Duration(milliseconds: 600),
              curve: Curves.easeOutSine,
              builder: (context, value, child) {
                return Container(
                  height: 6,
                  width: double.infinity,
                  decoration: BoxDecoration(
                    color: TruxifyColors.accent.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(3),
                  ),
                  child: FractionallySizedBox(
                    alignment: Alignment.centerLeft,
                    widthFactor: value,
                    child: Container(
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                  ),
                );
              },
            ),
          const SizedBox(height: 8),
          Text(
            '₹6,600 more to reach your ₹25,000 goal',
            style: textTheme.labelSmall?.copyWith(
              color: Colors.white.withValues(alpha: 0.7),
            ),
          ),
          const SizedBox(height: 16),
          // Stat Row
          Row(
            children: [
              Expanded(
                child: _buildHeroStat(
                    textTheme, '$totalTrips', 'Trips'),
              ),
              const Separator(height: 28),
              Expanded(
                child: _buildHeroStat(
                    textTheme, '₹${avgPerTrip.toInt()}', 'Avg/trip'),
              ),
              const Separator(height: 28),
              Expanded(
                child: _buildHeroStat(
                    textTheme, '${totalHours}h', 'Hours'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildHeroStat(
      TextTheme textTheme, String value, String label) {
    return Column(
      children: [
        Text(
          value,
          style: textTheme.titleSmall?.copyWith(
            color: Colors.white,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: textTheme.labelSmall?.copyWith(
            color: Colors.white.withValues(alpha: 0.5),
          ),
        ),
      ],
    );
  }

  // ── 2. Earnings Chart Card ───────────────────────────────────

  Widget _buildEarningsChartCard(
    BuildContext context,
    TextTheme textTheme,
    bool reduceMotion,
  ) {
    final selectedEarning = _selectedEarning;

    return AppCard(
      elevation: 1,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Your week at a glance',
            style:
                textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            "Tap any bar to see that day's details",
            style: textTheme.labelSmall
                ?.copyWith(color: TruxifyColors.hintText),
          ),
          const SizedBox(height: 20),
          // Chart
          SizedBox(
            height: 120,
            child: LayoutBuilder(
              builder: (context, constraints) {
                const double overhead =
                    12 + 4 + 6 + 20; // amount text + gap + bar gap + day label
                final double availableBarHeight =
                    (constraints.maxHeight - overhead).clamp(
                        20, constraints.maxHeight);
                final double safeMax = _maxAmount;

                return Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: List.generate(_earningsData.length, (index) {
                    final item = _earningsData[index];
                    final isSelected = index == _selectedBarIndex;
                    final isHighest =
                        item.amount.toDouble() == _maxAmount;
                    final double barHeight =
                        (item.amount.toDouble() / safeMax) *
                            availableBarHeight;

                    return Expanded(
                      child: Padding(
                        padding:
                            const EdgeInsets.symmetric(horizontal: 2),
                        child: _AnimatedBar(
                          index: index,
                          targetHeight: isSelected
                              ? barHeight + 2
                              : barHeight,
                          isSelected: isSelected,
                          isHighest: isHighest,
                          amount: item.amount,
                          day: item.day,
                          onTap: (i) {
                            setState(() {
                              _selectedBarIndex = i;
                            });
                          },
                          textTheme: textTheme,
                          reduceMotion: reduceMotion,
                          tabControllerIndex: _tabController.index,
                        ),
                      ),
                    );
                  }),
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          // Cross-fade detail badge
          if (selectedEarning != null)
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 200),
              transitionBuilder: (child, animation) {
                return FadeTransition(
                    opacity: animation, child: child);
              },
              child: Container(
                key: ValueKey(
                    'detail_${selectedEarning.day}_${_tabController.index}'),
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                    vertical: 8, horizontal: 16),
                decoration: BoxDecoration(
                  color: TruxifyColors.accentLight,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '${_getFullDayName(selectedEarning.day)} · ₹${selectedEarning.amount} · ${selectedEarning.tripCount} ${selectedEarning.tripCount == 1 ? 'trip' : 'trips'}',
                  textAlign: TextAlign.center,
                  style: textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                    color: TruxifyColors.accent,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  // ── 3. Breakdown Card ────────────────────────────────────────

  Widget _buildBreakdownCard(TextTheme textTheme) {
    return AppCard(
      elevation: 1,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Where your money comes from',
            style:
                textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          _buildBreakdownRow(
            textTheme,
            'Long haul (>400km)',
            60,
            '₹${_stats != null ? ((_stats!.totalAmount * 60 / 100).round()).toString() : '11,040'}',
            TruxifyColors.accent,
          ),
          const SizedBox(height: 12),
          _buildBreakdownRow(
            textTheme,
            'Short haul (<400km)',
            30,
            '₹${_stats != null ? ((_stats!.totalAmount * 30 / 100).round()).toString() : '5,520'}',
            TruxifyColors.warning,
          ),
          const SizedBox(height: 12),
          _buildBreakdownRow(
            textTheme,
            'Multi-customer loads',
            10,
            '₹${_stats != null ? ((_stats!.totalAmount * 10 / 100).round()).toString() : '1,840'}',
            TruxifyColors.success,
          ),
        ],
      ),
    );
  }

  Widget _buildBreakdownRow(
    TextTheme textTheme,
    String label,
    int percentage,
    String amount,
    Color color,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: textTheme.bodyMedium),
            Text(
              amount,
              style: textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Container(
          height: 6,
          width: double.infinity,
          decoration: BoxDecoration(
            color: TruxifyColors.border,
            borderRadius: BorderRadius.circular(3),
          ),
          child: FractionallySizedBox(
            alignment: Alignment.centerLeft,
            widthFactor: percentage / 100,
            child: Container(
              decoration: BoxDecoration(
                color: color,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          '$percentage% of earnings',
          style: textTheme.labelSmall
              ?.copyWith(color: TruxifyColors.hintText),
        ),
      ],
    );
  }

  // ── 4. Savings Comparison Card ───────────────────────────────

  Widget _buildSavingsCard(BuildContext context, TextTheme textTheme) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final stats = _stats;
    final truxifyAmount = stats?.totalAmount ?? 18400;
    final brokerAmount = (truxifyAmount * 0.7).round();
    final savedAmount = truxifyAmount - brokerAmount;

    return AppCard(
      elevation: 1,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'You vs broker system',
            style:
                textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: isDark
                        ? TruxifyColors.darkAccentLight
                        : TruxifyColors.accentLight,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'WITH TRUXIFY',
                        style: textTheme.labelSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.hintText,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _formatAmount(truxifyAmount),
                        style: textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.accent,
                        ),
                      ),
                      const SizedBox(height: 6),
                      StatusBadge(
                        label: 'You keep 100%',
                        backgroundColor: TruxifyColors.successLight,
                        foregroundColor: TruxifyColors.success,
                        icon: Icons.check_circle_rounded,
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: isDark
                        ? TruxifyColors.darkSecondaryBackground
                        : TruxifyColors.secondaryBackground,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'OLD BROKER SYSTEM',
                        style: textTheme.labelSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.hintText,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _formatAmount(brokerAmount),
                        style: textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w500,
                          color: TruxifyColors.hintText,
                          decoration: TextDecoration.lineThrough,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        "You'd lose ${_formatAmount(savedAmount)}",
                        style: textTheme.labelSmall?.copyWith(
                          color: TruxifyColors.errorRed,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Center(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Saved ${_formatAmount(savedAmount)} this week by going broker-free',
                  style: textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                    color: TruxifyColors.accent,
                  ),
                ),
                const SizedBox(width: 6),
                Icon(Icons.check_circle_rounded,
                    size: 14, color: TruxifyColors.success),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── 5. Milestones Card ───────────────────────────────────────

  Widget _buildMilestonesCard(TextTheme textTheme) {
    return AppCard(
      elevation: 1,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Milestones',
            style:
                textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          Semantics(
            label: 'Milestone: 100 Trips completed, Achieved on 12 Oct 2024',
            child: _buildMilestoneRow(
              Icons.emoji_events_outlined,
              TruxifyColors.accentLight,
              TruxifyColors.accent,
              '100 Trips completed',
              'Achieved on 12 Oct 2024',
              const Icon(Icons.check_circle_rounded,
                  color: TruxifyColors.success, size: 20),
              textTheme,
            ),
          ),
          const Divider(height: 1),
          Semantics(
            label: 'Milestone: ₹1 Lakh earned, Achieved on 5 Nov 2024',
            child: _buildMilestoneRow(
              Icons.star_outline_rounded,
              TruxifyColors.warningLight,
              TruxifyColors.warning,
              '₹1 Lakh earned',
              'Achieved on 5 Nov 2024',
              const Icon(Icons.check_circle_rounded,
                  color: TruxifyColors.success, size: 20),
              textTheme,
            ),
          ),
          const Divider(height: 1),
          Semantics(
            label: 'Milestone: 150 Trips, 142 of 150, 8 more to go',
            child: _buildMilestoneRow(
              Icons.flag_outlined,
              TruxifyColors.subtleBorder,
              TruxifyColors.hintText,
              '150 Trips',
              '142 of 150 · 8 more to go',
              SizedBox(
                width: 64,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(2),
                  child: LinearProgressIndicator(
                    value: 0.95,
                    color: TruxifyColors.accent,
                    backgroundColor: TruxifyColors.border,
                    minHeight: 4,
                  ),
                ),
              ),
              textTheme,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMilestoneRow(
    IconData icon,
    Color iconBgColor,
    Color iconColor,
    String title,
    String subtitle,
    Widget trailing,
    TextTheme textTheme,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: iconBgColor,
            ),
            child: Icon(icon, color: iconColor, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: textTheme.bodyMedium
                      ?.copyWith(fontWeight: FontWeight.w500),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  style: textTheme.labelSmall
                      ?.copyWith(color: TruxifyColors.hintText),
                ),
              ],
            ),
          ),
          trailing,
        ],
      ),
    );
  }

  // ── 6. Pending Payments Card ─────────────────────────────────

  Widget _buildPendingPaymentsCard(TextTheme textTheme) {
    final isDarkPending = Theme.of(context).brightness == Brightness.dark;
    return AppCard(
      elevation: 1,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Pending',
                style: textTheme.titleMedium
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              Text(
                '₹${
                  _totalPendingAmount > 0
                      ? _formatAmount(_totalPendingAmount).replaceFirst('₹', '')
                      : '4,700'
                }',
                style: textTheme.labelMedium?.copyWith(
                  fontWeight: FontWeight.w500,
                  color: TruxifyColors.accent,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ...pendingPayments.map((item) {
            final initials = item.customerName.isNotEmpty
                ? item.customerName
                    .split(' ')
                    .map((e) => e[0])
                    .join('')
                : 'C';
            return Semantics(
              label: 'Pending payment from ${item.customerName}',
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Row(
                  children: [
                    Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: isDarkPending
                            ? TruxifyColors.darkAccentLight
                            : TruxifyColors.accentLight,
                      ),
                      child: Center(
                        child: Text(
                          initials,
                          style: textTheme.labelMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                            color: TruxifyColors.accent,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            item.customerName,
                            style: textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                          Text(
                            '${item.route} · ${item.note}',
                            style: textTheme.labelSmall?.copyWith(
                              color: TruxifyColors.hintText,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Text(
                      item.amount,
                      style: textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: TruxifyColors.accent,
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}

// ── Animated Section Wrapper ─────────────────────────────────────

class _AnimatedSection extends StatefulWidget {
  final Widget child;
  final Duration delay;
  final bool reduceMotion;

  const _AnimatedSection({
    required this.child,
    required this.delay,
    this.reduceMotion = false,
  });

  @override
  State<_AnimatedSection> createState() => _AnimatedSectionState();
}

class _AnimatedSectionState extends State<_AnimatedSection>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );
    _animation = CurvedAnimation(parent: _controller, curve: Curves.easeOut);
    Future.delayed(widget.delay, () {
      if (mounted) _controller.forward();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.reduceMotion) return widget.child;
    return FadeTransition(
      opacity: _animation,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 0.1),
          end: Offset.zero,
        ).animate(_animation),
        child: widget.child,
      ),
    );
  }
}

// ── Animated Bar ─────────────────────────────────────────────────

class _AnimatedBar extends StatefulWidget {
  final int index;
  final double targetHeight;
  final bool isSelected;
  final bool isHighest;
  final int amount;
  final String day;
  final ValueChanged<int> onTap;
  final TextTheme textTheme;
  final bool reduceMotion;
  final int tabControllerIndex;

  const _AnimatedBar({
    required this.index,
    required this.targetHeight,
    required this.isSelected,
    required this.isHighest,
    required this.amount,
    required this.day,
    required this.onTap,
    required this.textTheme,
    required this.reduceMotion,
    required this.tabControllerIndex,
  });

  @override
  State<_AnimatedBar> createState() => _AnimatedBarState();
}

class _AnimatedBarState extends State<_AnimatedBar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
    _animation =
        CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic);
    Future.delayed(Duration(milliseconds: widget.index * 50), () {
      if (mounted) _controller.forward();
    });
  }

  @override
  void didUpdateWidget(covariant _AnimatedBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.tabControllerIndex != widget.tabControllerIndex) {
      _controller.reset();
      Future.delayed(Duration(milliseconds: widget.index * 50), () {
        if (mounted) _controller.forward();
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  String _getCompactAmount(double amount) {
    if (amount >= 1000) {
      return '₹${(amount / 1000).toStringAsFixed(1)}k';
    }
    return '₹${amount.toInt()}';
  }

  @override
  Widget build(BuildContext context) {
    final double animatedHeight =
        widget.reduceMotion ? widget.targetHeight : widget.targetHeight * _animation.value;

    return Column(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        // Amount label above bar
        SizedBox(
          height: 12,
          child: (widget.isSelected || widget.isHighest)
              ? Text(
                  _getCompactAmount(widget.amount.toDouble()),
                  style: widget.textTheme.labelSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: TruxifyColors.accent,
                  ),
                )
              : null,
        ),
        const SizedBox(height: 4),
        // Bar with touch target
        Semantics(
          label:
              'Earning of ${widget.amount} rupees on ${widget.day}',
          child: GestureDetector(
            onTap: () => widget.onTap(widget.index),
            behavior: HitTestBehavior.opaque,
            child: SizedBox(
              width: 44, // min WCAG touch target
              child: Center(
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  curve: Curves.easeInOut,
                  height: animatedHeight,
                  width: 36,
                  decoration: widget.isSelected
                      ? BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [
                              TruxifyColors.accent,
                              TruxifyColors.accentDark,
                            ],
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                          ),
                          borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(6),
                          ),
                        )
                      : BoxDecoration(
                          color: widget.isHighest
                              ? TruxifyColors.accent
                              : TruxifyColors.accentLight,
                          borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(6),
                          ),
                        ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 8),
        // Day label
        Text(
          widget.day,
          style: widget.textTheme.labelSmall?.copyWith(
            color: TruxifyColors.hintText,
            fontWeight:
                widget.isSelected ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ],
    );
  }
}
