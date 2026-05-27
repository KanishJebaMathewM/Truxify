import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../data/mock_data.dart';
import '../widgets/common_widgets.dart';

class EarningsScreen extends StatefulWidget {
  const EarningsScreen({super.key});

  @override
  State<EarningsScreen> createState() => _EarningsScreenState();
}

class _EarningsScreenState extends State<EarningsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  int _selectedBarIndex = 3;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this, initialIndex: 1);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        setState(() {});
      }
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  String _getCompactAmount(double amount) {
    if (amount >= 1000) {
      return '₹${(amount / 1000).toStringAsFixed(1)}k';
    }
    return '₹${amount.toInt()}';
  }

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

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;

    final double maxAmount = weeklyEarnings
        .map((e) => e.amount.toDouble())
        .reduce((a, b) => a > b ? a : b);

    final selectedEarning = weeklyEarnings[_selectedBarIndex];

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
              labelStyle: textTheme.labelMedium
                  ?.copyWith(fontWeight: FontWeight.w600),
              unselectedLabelStyle: textTheme.labelMedium,
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

          // Scrollable Content
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              child: Column(
                children: [
                  // 1. Hero Total Card
                  _buildHeroCard(context, textTheme),

                  const SizedBox(height: 16),

                  // 2. Earnings Story Card (Bar Chart)
                  _buildEarningsChartCard(context, textTheme, maxAmount, selectedEarning),

                  const SizedBox(height: 24),

                  // 3. Breakdown Card
                  _buildBreakdownCard(context, textTheme),

                  const SizedBox(height: 24),

                  // 4. Savings Comparison Card
                  _buildSavingsCard(context, textTheme),

                  const SizedBox(height: 24),

                  // 5. Milestones Card
                  _buildMilestonesCard(context, textTheme),

                  const SizedBox(height: 24),

                  // 6. Pending Payments Card
                  _buildPendingPaymentsCard(context, textTheme),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Hero Card ──────────────────────────────────────────

  Widget _buildHeroCard(BuildContext context, TextTheme textTheme) {
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
          Text(
            '₹18,400',
            style: textTheme.displaySmall?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 12),
          // Goal Progress
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
              Expanded(child: _buildHeroStat(context, '8', 'Trips')),
              const Separator(height: 28),
              Expanded(child: _buildHeroStat(context, '₹2,300', 'Avg/trip')),
              const Separator(height: 28),
              Expanded(child: _buildHeroStat(context, '42h', 'Hours')),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildHeroStat(BuildContext context, String value, String label) {
    final textTheme = Theme.of(context).textTheme;
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

  // ── Earnings Chart Card ────────────────────────────────

  Widget _buildEarningsChartCard(
    BuildContext context,
    TextTheme textTheme,
    double maxAmount,
    dynamic selectedEarning,
  ) {
    return AppCard(
      elevation: 1,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Your week at a glance',
            style: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            "Tap any bar to see that day's details",
            style: textTheme.labelSmall?.copyWith(color: TruxifyColors.hintText),
          ),
          const SizedBox(height: 20),
          // Chart
          SizedBox(
            height: 120,
            child: LayoutBuilder(
              builder: (context, constraints) {
                const double overhead = 12 + 4 + 6 + 20; // amount text + gap + bar gap + day label
                final double availableBarHeight =
                    (constraints.maxHeight - overhead).clamp(20, constraints.maxHeight);
                final double safeMax = maxAmount > 0 ? maxAmount : 1;

                return Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: List.generate(weeklyEarnings.length, (index) {
                    final item = weeklyEarnings[index];
                    final isSelected = index == _selectedBarIndex;
                    final isHighest = item.amount.toDouble() == maxAmount;
                    final double barHeight =
                        (item.amount.toDouble() / safeMax) * availableBarHeight;

                    return Expanded(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          // Amount label above bar
                          SizedBox(
                            height: 12,
                            child: (isSelected || isHighest)
                                ? Text(
                                    _getCompactAmount(item.amount.toDouble()),
                                    style: textTheme.labelSmall?.copyWith(
                                      fontWeight: FontWeight.bold,
                                      color: TruxifyColors.accent,
                                    ),
                                  )
                                : null,
                          ),
                          const SizedBox(height: 4),
                          // Bar
                          Semantics(
                            label:
                                'Earning of ${item.amount} rupees on ${item.day}',
                            child: GestureDetector(
                              onTap: () {
                                setState(() {
                                  _selectedBarIndex = index;
                                });
                              },
                              child: AnimatedContainer(
                                duration: const Duration(milliseconds: 300),
                                curve: Curves.easeInOut,
                                height: barHeight,
                                width: 24,
                                decoration: BoxDecoration(
                                  color: isSelected
                                      ? TruxifyColors.accentDark
                                      : (isHighest
                                          ? TruxifyColors.accent
                                          : TruxifyColors.accentLight),
                                  borderRadius: const BorderRadius.vertical(
                                    top: Radius.circular(6),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 8),
                          // Day label
                          Text(
                            item.day,
                            style: textTheme.labelSmall?.copyWith(
                              color: TruxifyColors.hintText,
                              fontWeight:
                                  isSelected ? FontWeight.bold : FontWeight.normal,
                            ),
                          ),
                        ],
                      ),
                    );
                  }),
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          // Selected Day Detail
          Center(
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
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

  // ── Breakdown Card ─────────────────────────────────────

  Widget _buildBreakdownCard(BuildContext context, TextTheme textTheme) {
    return AppCard(
      elevation: 1,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Where your money comes from',
            style: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          _buildBreakdownRow(
            context,
            'Long haul (>400km)',
            60,
            '₹11,040',
            TruxifyColors.accent,
          ),
          const SizedBox(height: 12),
          _buildBreakdownRow(
            context,
            'Short haul (<400km)',
            30,
            '₹5,520',
            TruxifyColors.warning,
          ),
          const SizedBox(height: 12),
          _buildBreakdownRow(
            context,
            'Multi-customer loads',
            10,
            '₹1,840',
            TruxifyColors.success,
          ),
        ],
      ),
    );
  }

  Widget _buildBreakdownRow(
    BuildContext context,
    String label,
    int percentage,
    String amount,
    Color color,
  ) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: textTheme.bodyMedium,
            ),
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
          style: textTheme.labelSmall?.copyWith(color: TruxifyColors.hintText),
        ),
      ],
    );
  }

  // ── Savings Comparison Card ────────────────────────────

  Widget _buildSavingsCard(BuildContext context, TextTheme textTheme) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return AppCard(
      elevation: 1,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'You vs broker system',
            style: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
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
                        '₹18,400',
                        style: textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.accent,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'You keep 100%',
                        style: textTheme.labelSmall?.copyWith(
                          color: TruxifyColors.success,
                          fontWeight: FontWeight.w500,
                        ),
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
                        '₹12,880',
                        style: textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w500,
                          color: TruxifyColors.hintText,
                          decoration: TextDecoration.lineThrough,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        "You'd lose ₹5,520",
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
                  'Saved ₹5,520 this week by going broker-free',
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

  // ── Milestones Card ────────────────────────────────────

  Widget _buildMilestonesCard(BuildContext context, TextTheme textTheme) {
    return AppCard(
      elevation: 1,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Milestones',
            style: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
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
  ) {
    final textTheme = Theme.of(context).textTheme;
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
                  style: textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  style: textTheme.labelSmall?.copyWith(
                    color: TruxifyColors.hintText,
                  ),
                ),
              ],
            ),
          ),
          trailing,
        ],
      ),
    );
  }

  // ── Pending Payments Card ──────────────────────────────

  Widget _buildPendingPaymentsCard(
    BuildContext context,
    TextTheme textTheme,
  ) {
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
                style: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
              ),
              Text(
                '₹4,700',
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
                ? item.customerName.split(' ').map((e) => e[0]).join('')
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
