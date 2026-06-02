import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/app_theme.dart';
import '../data/mock_data.dart';

class EarningsScreen extends StatefulWidget {
  const EarningsScreen({super.key});

  @override
  State<EarningsScreen> createState() => _EarningsScreenState();
}

class _EarningsScreenState extends State<EarningsScreen> {
  int _selectedPeriodIndex = 1; // 0: Today, 1: Week, 2: Month
  int _selectedBarIndex = 3; // Thursday is default (index 3)

  final List<String> _periods = ['Today', 'This Week', 'This Month'];

  String _getCompactAmount(double amount) {
    if (amount >= 1000) {
      return '₹${(amount / 1000).toStringAsFixed(1)}k';
    }
    return '₹${amount.toInt()}';
  }

  @override
  Widget build(BuildContext context) {
    final double maxAmount = weeklyEarnings
        .map((e) => e.amount.toDouble())
        .reduce((a, b) => a > b ? a : b);

    final selectedEarning = weeklyEarnings[_selectedBarIndex];

    return SafeArea(
      child: Scaffold(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        body: Column(
          children: [
            // Top Bar
            Container(
              color: Theme.of(context).colorScheme.surface,
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Text(
                'Earnings',
                style: GoogleFonts.dmSans(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
            ),
            Container(height: 1, color: TruxifyColors.border),

            // Scrollable Body
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Column(
                  children: [
                    // 1. Period Selector
                    Padding(
                      padding: const EdgeInsets.only(
                          left: 16, right: 16, bottom: 16),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: List.generate(_periods.length, (index) {
                          final isSelected = index == _selectedPeriodIndex;
                          return GestureDetector(
                            onTap: () {
                              setState(() {
                                _selectedPeriodIndex = index;
                              });
                            },
                            child: Container(
                              margin: const EdgeInsets.symmetric(horizontal: 4),
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 20, vertical: 6),
                              decoration: BoxDecoration(
                                color: isSelected
                                    ? TruxifyColors.accent
                                    : Theme.of(context).colorScheme.surface,
                                border: Border.all(
                                  color: isSelected
                                      ? TruxifyColors.accent
                                      : TruxifyColors.border,
                                ),
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: Text(
                                _periods[index],
                                style: GoogleFonts.dmSans(
                                  fontSize: 12,
                                  fontWeight: isSelected
                                      ? FontWeight.w600
                                      : FontWeight.normal,
                                  color: isSelected
                                      ? Colors.white
                                      : TruxifyColors.hintText,
                                ),
                              ),
                            ),
                          );
                        }),
                      ),
                    ),

                    // 2. Hero Total Card
                    Container(
                      margin: const EdgeInsets.only(
                          left: 16, right: 16, bottom: 16),
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [TruxifyColors.accent, Color(0xFF5E0B0B)],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'TOTAL EARNED',
                            style: GoogleFonts.dmSans(
                              color: Colors.white.withOpacity(0.6),
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 1.0,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '₹18,400',
                            style: GoogleFonts.dmSans(
                              color: Theme.of(context).colorScheme.surface,
                              fontSize: 38,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 12),
                          // Goal progress
                          Container(
                            height: 6,
                            width: double.infinity,
                            decoration: BoxDecoration(
                              color: Colors.white.withOpacity(0.2),
                              borderRadius: BorderRadius.circular(3),
                            ),
                            child: FractionallySizedBox(
                              alignment: Alignment.centerLeft,
                              widthFactor: 0.74,
                              child: Container(
                                decoration: BoxDecoration(
                                  color: Theme.of(context).colorScheme.surface,
                                  borderRadius: BorderRadius.circular(3),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            '₹6,600 more to reach your ₹25,000 goal',
                            style: GoogleFonts.dmSans(
                              color: Colors.white.withOpacity(0.7),
                              fontSize: 11,
                            ),
                          ),
                          const SizedBox(height: 16),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                            children: [
                              Expanded(
                                child: Column(
                                  children: [
                                    Text(
                                      '8',
                                      style: GoogleFonts.dmSans(
                                        color: Theme.of(context)
                                            .colorScheme
                                            .surface,
                                        fontSize: 14,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      'Trips',
                                      style: GoogleFonts.dmSans(
                                        color: Colors.white.withOpacity(0.5),
                                        fontSize: 10,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Container(
                                width: 1,
                                height: 28,
                                color: Colors.white.withOpacity(0.15),
                              ),
                              Expanded(
                                child: Column(
                                  children: [
                                    Text(
                                      '₹2,300',
                                      style: GoogleFonts.dmSans(
                                        color: Theme.of(context)
                                            .colorScheme
                                            .surface,
                                        fontSize: 14,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      'Avg/trip',
                                      style: GoogleFonts.dmSans(
                                        color: Colors.white.withOpacity(0.5),
                                        fontSize: 10,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Container(
                                width: 1,
                                height: 28,
                                color: Colors.white.withOpacity(0.15),
                              ),
                              Expanded(
                                child: Column(
                                  children: [
                                    Text(
                                      '42h',
                                      style: GoogleFonts.dmSans(
                                        color: Theme.of(context)
                                            .colorScheme
                                            .surface,
                                        fontSize: 14,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      'Hours',
                                      style: GoogleFonts.dmSans(
                                        color: Colors.white.withOpacity(0.5),
                                        fontSize: 10,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),

                    // 3. Earnings Story Card
                    Container(
                      margin: const EdgeInsets.only(
                          left: 16, right: 16, bottom: 16),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surface,
                        border: Border.all(color: TruxifyColors.border),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Your week at a glance',
                            style: GoogleFonts.dmSans(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: Theme.of(context).colorScheme.onSurface,
                            ),
                          ),
                          Text(
                            "Tap any bar to see that day's details",
                            style: GoogleFonts.dmSans(
                              fontSize: 11,
                              color: TruxifyColors.hintText,
                            ),
                          ),
                          const SizedBox(height: 20),
                          // Chart Row
                          SizedBox(
                            height: 110,
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children:
                                  List.generate(weeklyEarnings.length, (index) {
                                final item = weeklyEarnings[index];
                                final isSelected = index == _selectedBarIndex;
                                final isHighest =
                                    item.amount.toDouble() == maxAmount;

                                // Responsive bar height calculation based on screen size.
                                final double barHeight =
                                    (item.amount.toDouble() / maxAmount) *
                                        (MediaQuery.sizeOf(context).height /
                                            14.1);

                                return Expanded(
                                  child: Column(
                                    mainAxisAlignment: MainAxisAlignment.end,
                                    children: [
                                      // Top Amount Text (show if selected or highest)
                                      SizedBox(
                                        height: 12,
                                        child: (isSelected || isHighest)
                                            ? Text(
                                                _getCompactAmount(
                                                    item.amount.toDouble()),
                                                style: GoogleFonts.dmSans(
                                                  fontSize: 9,
                                                  fontWeight: FontWeight.bold,
                                                  color: TruxifyColors.accent,
                                                ),
                                              )
                                            : null,
                                      ),
                                      const SizedBox(height: 4),
                                      // The Bar
                                      GestureDetector(
                                        onTap: () {
                                          setState(() {
                                            _selectedBarIndex = index;
                                          });
                                        },
                                        child: AnimatedContainer(
                                          duration:
                                              const Duration(milliseconds: 300),
                                          curve: Curves.easeInOut,
                                          height: barHeight,
                                          width: 24,
                                          decoration: BoxDecoration(
                                            color: isSelected
                                                ? const Color(0xFF5E0B0B)
                                                : (isHighest
                                                    ? TruxifyColors.accent
                                                    : TruxifyColors
                                                        .accentLight),
                                            borderRadius:
                                                const BorderRadius.vertical(
                                              top: Radius.circular(6),
                                            ),
                                          ),
                                        ),
                                      ),
                                      const SizedBox(height: 6),
                                      // Day Label
                                      Text(
                                        item.day,
                                        style: GoogleFonts.dmSans(
                                          fontSize: 10,
                                          color: TruxifyColors.hintText,
                                          fontWeight: isSelected
                                              ? FontWeight.bold
                                              : FontWeight.normal,
                                        ),
                                      ),
                                    ],
                                  ),
                                );
                              }),
                            ),
                          ),
                          const SizedBox(height: 16),
                          // Selected Detail
                          Center(
                            child: Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(
                                  vertical: 8, horizontal: 14),
                              decoration: BoxDecoration(
                                color: TruxifyColors.accentLight,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                '${_getFullDayName(selectedEarning.day)} · ₹${selectedEarning.amount} · ${selectedEarning.tripCount} ${selectedEarning.tripCount == 1 ? 'trip' : 'trips'}',
                                textAlign: TextAlign.center,
                                style: GoogleFonts.dmSans(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w500,
                                  color: TruxifyColors.accent,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    // 4. Breakdown Card
                    Container(
                      margin: const EdgeInsets.only(
                          left: 16, right: 16, bottom: 16),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surface,
                        border: Border.all(color: TruxifyColors.border),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Where your money comes from',
                            style: GoogleFonts.dmSans(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: Theme.of(context).colorScheme.onSurface,
                            ),
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
                    ),

                    // 5. Savings Comparison Card
                    Container(
                      margin: const EdgeInsets.only(
                          left: 16, right: 16, bottom: 16),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surface,
                        border: Border.all(color: TruxifyColors.border),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'You vs broker system',
                            style: GoogleFonts.dmSans(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: Theme.of(context).colorScheme.onSurface,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              Expanded(
                                child: Container(
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFFF5F5),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'WITH TRUXIFY',
                                        style: GoogleFonts.dmSans(
                                          fontSize: 10,
                                          color: TruxifyColors.hintText,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        '₹18,400',
                                        style: GoogleFonts.dmSans(
                                          fontSize: 20,
                                          fontWeight: FontWeight.bold,
                                          color: TruxifyColors.accent,
                                        ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        'You keep 100%',
                                        style: GoogleFonts.dmSans(
                                          fontSize: 11,
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
                                    color: const Color(0xFFF5F5F5),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'OLD BROKER SYSTEM',
                                        style: GoogleFonts.dmSans(
                                          fontSize: 10,
                                          color: TruxifyColors.hintText,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        '₹12,880',
                                        style: GoogleFonts.dmSans(
                                          fontSize: 20,
                                          fontWeight: FontWeight.w500,
                                          color: TruxifyColors.hintText,
                                          decoration:
                                              TextDecoration.lineThrough,
                                        ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        "You'd lose ₹5,520",
                                        style: GoogleFonts.dmSans(
                                          fontSize: 11,
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
                            child: Text(
                              'Saved ₹5,520 this week by going broker-free 🎉',
                              style: GoogleFonts.dmSans(
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                                color: TruxifyColors.accent,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    // 6. Milestones Card
                    Container(
                      margin: const EdgeInsets.only(
                          left: 16, right: 16, bottom: 16),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surface,
                        border: Border.all(color: TruxifyColors.border),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Milestones',
                            style: GoogleFonts.dmSans(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: Theme.of(context).colorScheme.onSurface,
                            ),
                          ),
                          const SizedBox(height: 12),
                          _buildMilestoneRow(
                            Icons.emoji_events_outlined,
                            const Color(0xFFFDEAEA),
                            TruxifyColors.accent,
                            '100 Trips completed',
                            'Achieved on 12 Oct 2024',
                            const Text(
                              '✓',
                              style: TextStyle(
                                color: TruxifyColors.success,
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          const Divider(color: TruxifyColors.border),
                          _buildMilestoneRow(
                            Icons.star_outline_rounded,
                            const Color(0xFFFFF3E0),
                            TruxifyColors.warning,
                            '₹1 Lakh earned',
                            'Achieved on 5 Nov 2024',
                            const Text(
                              '✓',
                              style: TextStyle(
                                color: TruxifyColors.success,
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          const Divider(color: TruxifyColors.border),
                          _buildMilestoneRow(
                            Icons.flag_outlined,
                            const Color(0xFFEBEBEB),
                            TruxifyColors.hintText,
                            '150 Trips',
                            '142 of 150 · 8 more to go',
                            SizedBox(
                              width: 60,
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(2),
                                child: const LinearProgressIndicator(
                                  value: 0.95,
                                  color: TruxifyColors.accent,
                                  backgroundColor: TruxifyColors.border,
                                  minHeight: 4,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    // 7. Pending Payments Card
                    Container(
                      margin: const EdgeInsets.only(
                          left: 16, right: 16, bottom: 24),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surface,
                        border: Border.all(color: TruxifyColors.border),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                'Pending',
                                style: GoogleFonts.dmSans(
                                  fontSize: 14,
                                  fontWeight: FontWeight.bold,
                                  color:
                                      Theme.of(context).colorScheme.onSurface,
                                ),
                              ),
                              Text(
                                '₹4,700',
                                style: GoogleFonts.dmSans(
                                  fontSize: 12,
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
                            return Padding(
                              padding:
                                  const EdgeInsets.symmetric(vertical: 8.0),
                              child: Row(
                                children: [
                                  Container(
                                    width: 32,
                                    height: 32,
                                    decoration: const BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: TruxifyColors.accentLight,
                                    ),
                                    child: Center(
                                      child: Text(
                                        initials,
                                        style: GoogleFonts.dmSans(
                                          fontSize: 11,
                                          fontWeight: FontWeight.bold,
                                          color: TruxifyColors.accent,
                                        ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          item.customerName,
                                          style: GoogleFonts.dmSans(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w500,
                                            color: Theme.of(context)
                                                .colorScheme
                                                .onSurface,
                                          ),
                                        ),
                                        Text(
                                          '${item.route} · ${item.note}',
                                          style: GoogleFonts.dmSans(
                                            fontSize: 10,
                                            color: TruxifyColors.hintText,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Text(
                                    item.amount,
                                    style: GoogleFonts.dmSans(
                                      fontSize: 13,
                                      fontWeight: FontWeight.bold,
                                      color: TruxifyColors.accent,
                                    ),
                                  ),
                                ],
                              ),
                            );
                          }),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: GoogleFonts.dmSans(
                fontSize: 13,
                color: Theme.of(context).colorScheme.onSurface,
              ),
            ),
            Text(
              amount,
              style: GoogleFonts.dmSans(
                fontSize: 13,
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
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
        const SizedBox(height: 2),
        Text(
          '$percentage% of earnings',
          style: GoogleFonts.dmSans(
            fontSize: 10,
            color: TruxifyColors.hintText,
          ),
        ),
      ],
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
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: iconBgColor,
            ),
            child: Icon(
              icon,
              color: iconColor,
              size: 18,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: GoogleFonts.dmSans(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                ),
                Text(
                  subtitle,
                  style: GoogleFonts.dmSans(
                    fontSize: 11,
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
}
