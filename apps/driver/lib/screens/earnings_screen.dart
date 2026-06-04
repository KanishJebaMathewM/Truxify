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
  // Current calendar view month/year
  int _currentYear = 2026;
  int _currentMonth = 5; // Default to May 2026

  // Currently selected date for detailed stats (Default to May 14, 2026)
  late DateTime _selectedDate;

  // Map of daily earnings and statistics (May/June 2026)
  // Key format: "YYYY-MM-DD"
  final Map<String, Map<String, dynamic>> _dailyData = {
    // May 2026 daily data
    '2026-05-01': {
      'earnings': 3800.0,
      'hours': 8.5,
      'trips': [
        {
          'route': 'Surat → Vadodara',
          'customer': 'Karthik Murugan',
          'amount': '₹3,800',
          'status': 'Delivered',
          'hash': '0x3a574d5c8f2c...31128',
          'verified': true,
        }
      ],
    },
    '2026-05-02': {
      'earnings': 0.0,
      'hours': 2.0,
      'trips': [
        {
          'route': 'Vadodara → Mumbai',
          'customer': 'Mehta Traders',
          'amount': '₹0',
          'status': 'Cancelled',
          'hash': '0x1aa63bce90...c901',
          'verified': false,
        }
      ],
    },
    '2026-05-03': {
      'earnings': 1300.0,
      'hours': 4.0,
      'trips': [
        {
          'route': 'Surat → Mumbai',
          'customer': 'Raj Textiles',
          'amount': '₹1,300',
          'status': 'Delivered',
          'hash': '0x4f128bc...de98',
          'verified': true,
        }
      ],
    },
    '2026-05-04': {
      'earnings': 1200.0,
      'hours': 3.5,
      'trips': [
        {
          'route': 'Surat → Mumbai',
          'customer': 'Mehta Traders',
          'amount': '₹1,200',
          'status': 'Delivered',
          'hash': '0x8f2d5e1...bc90',
          'verified': true,
        }
      ],
    },
    '2026-05-05': {
      'earnings': 3400.0,
      'hours': 7.8,
      'trips': [
        {
          'route': 'Vadodara → Pune',
          'customer': 'Sri Textiles',
          'amount': '₹3,400',
          'status': 'Delivered',
          'hash': '0x9cf11a4b5e...1b39',
          'verified': true,
        }
      ],
    },
    '2026-05-06': {
      'earnings': 2100.0,
      'hours': 5.0,
      'trips': [
        {
          'route': 'Vadodara → Mumbai',
          'customer': 'Mehta Traders',
          'amount': '₹2,100',
          'status': 'Delivered',
          'hash': '0x2d9e1f4...5def',
          'verified': true,
        }
      ],
    },
    '2026-05-07': {
      'earnings': 4800.0,
      'hours': 8.2,
      'trips': [
        {
          'route': 'Ahmedabad → Pune',
          'customer': 'Sri Textiles',
          'amount': '₹4,800',
          'status': 'Delivered',
          'hash': '0x9cf11a4...1b39',
          'verified': true,
        }
      ],
    },
    '2026-05-08': {
      'earnings': 2400.0,
      'hours': 6.0,
      'trips': [
        {
          'route': 'Surat → Jaipur',
          'customer': 'Karthik Murugan',
          'amount': '₹2,400',
          'status': 'Delivered',
          'hash': '0x7e1a3bc...2d9e',
          'verified': true,
        }
      ],
    },
    '2026-05-10': {
      'earnings': 1500.0,
      'hours': 4.5,
      'trips': [
        {
          'route': 'Vadodara → Ahmedabad',
          'customer': 'Krishna Exports',
          'amount': '₹1,500',
          'status': 'Delivered',
          'hash': '0x5b2b1e3...6ad1',
          'verified': true,
        }
      ],
    },
    '2026-05-11': {
      'earnings': 8400.0,
      'hours': 17.8,
      'trips': [
        {
          'route': 'Mumbai → Delhi',
          'customer': 'Raj Textiles',
          'amount': '₹8,400',
          'status': 'Delivered',
          'hash': '0x5b2b1e3...6ad1',
          'verified': true,
        }
      ],
    },
    '2026-05-13': {
      'earnings': 3100.0,
      'hours': 7.0,
      'trips': [
        {
          'route': 'Vadodara → Jaipur',
          'customer': 'Mehta Traders',
          'amount': '₹3,100',
          'status': 'Delivered',
          'hash': '0x3a574d5...8f2c',
          'verified': true,
        }
      ],
    },
    '2026-05-14': {
      'earnings': 5200.0,
      'hours': 9.5,
      'trips': [
        {
          'route': 'Surat → Jaipur',
          'customer': 'Karthik Murugan',
          'amount': '₹5,200',
          'status': 'Delivered',
          'hash': '0x3a574d5...8f2c',
          'verified': true,
        }
      ],
    },
    '2026-05-15': {
      'earnings': 4200.0,
      'hours': 9.0,
      'trips': [
        {
          'route': 'Ahmedabad → Pune',
          'customer': 'Sri Textiles',
          'amount': '₹2,400',
          'status': 'Delivered',
          'hash': '0x9cf11a4b5e...1b39',
          'verified': true,
        },
        {
          'route': 'Pune → Mumbai',
          'customer': 'Mehta Traders',
          'amount': '₹1,800',
          'status': 'Delivered',
          'hash': '0x1aa63bce90...c901',
          'verified': true,
        }
      ],
    },
    '2026-05-16': {
      'earnings': 2400.0,
      'hours': 5.5,
      'trips': [
        {
          'route': 'Surat → Ahmedabad',
          'customer': 'Karthik Murugan',
          'amount': '₹2,400',
          'status': 'Delivered',
          'hash': '0x7e1a3bc...2d9e',
          'verified': true,
        }
      ],
    },
    '2026-05-18': {
      'earnings': 2200.0,
      'hours': 5.2,
      'trips': [
        {
          'route': 'Vadodara → Jaipur',
          'customer': 'Mehta Traders',
          'amount': '₹2,200',
          'status': 'Delivered',
          'hash': '0x3a574d5...8f2c',
          'verified': true,
        }
      ],
    },
    '2026-05-19': {
      'earnings': 4500.0,
      'hours': 10.0,
      'trips': [
        {
          'route': 'Mumbai → Delhi',
          'customer': 'Raj Textiles',
          'amount': '₹2,500',
          'status': 'Delivered',
          'hash': '0x5b2b1e3...6ad1',
          'verified': true,
        },
        {
          'route': 'Delhi → Jaipur',
          'customer': 'Sharma Exports',
          'amount': '₹2,000',
          'status': 'Delivered',
          'hash': '0x9cf11a4b5e...1b39',
          'verified': true,
        }
      ],
    },
    '2026-05-20': {
      'earnings': 2800.0,
      'hours': 6.5,
      'trips': [
        {
          'route': 'Vadodara → Pune',
          'customer': 'Sri Textiles',
          'amount': '₹2,800',
          'status': 'Delivered',
          'hash': '0x9cf11a4b5e...1b39',
          'verified': true,
        }
      ],
    },
    '2026-05-21': {
      'earnings': 3900.0,
      'hours': 8.0,
      'trips': [
        {
          'route': 'Surat → Jaipur',
          'customer': 'Karthik Murugan',
          'amount': '₹3,900',
          'status': 'Delivered',
          'hash': '0x3a574d5...8f2c',
          'verified': true,
        }
      ],
    },
    '2026-05-22': {
      'earnings': 5100.0,
      'hours': 11.2,
      'trips': [
        {
          'route': 'Mumbai → Ahmedabad',
          'customer': 'Raj Textiles',
          'amount': '₹3,100',
          'status': 'Delivered',
          'hash': '0x5b2b1e3...6ad1',
          'verified': true,
        },
        {
          'route': 'Ahmedabad → Surat',
          'customer': 'Mehta Traders',
          'amount': '₹2,000',
          'status': 'Delivered',
          'hash': '0x1aa63bce90...c901',
          'verified': true,
        }
      ],
    },
    '2026-05-23': {
      'earnings': 1800.0,
      'hours': 4.0,
      'trips': [
        {
          'route': 'Vadodara → Jaipur',
          'customer': 'Mehta Traders',
          'amount': '₹1,800',
          'status': 'Delivered',
          'hash': '0x3a574d5...8f2c',
          'verified': true,
        }
      ],
    },
    '2026-05-25': {
      'earnings': 3000.0,
      'hours': 6.8,
      'trips': [
        {
          'route': 'Surat → Mumbai',
          'customer': 'Karthik Murugan',
          'amount': '₹3,000',
          'status': 'Delivered',
          'hash': '0x7e1a3bc...2d9e',
          'verified': true,
        }
      ],
    },
    '2026-05-26': {
      'earnings': 4100.0,
      'hours': 9.5,
      'trips': [
        {
          'route': 'Ahmedabad → Pune',
          'customer': 'Sri Textiles',
          'amount': '₹2,500',
          'status': 'Delivered',
          'hash': '0x9cf11a4b5e...1b39',
          'verified': true,
        },
        {
          'route': 'Pune → Mumbai',
          'customer': 'Mehta Traders',
          'amount': '₹1,600',
          'status': 'Delivered',
          'hash': '0x1aa63bce90...c901',
          'verified': true,
        }
      ],
    },
    '2026-05-27': {
      'earnings': 2300.0,
      'hours': 5.4,
      'trips': [
        {
          'route': 'Surat → Ahmedabad',
          'customer': 'Karthik Murugan',
          'amount': '₹2,300',
          'status': 'Delivered',
          'hash': '0x7e1a3bc...2d9e',
          'verified': true,
        }
      ],
    },
    '2026-05-28': {
      'earnings': 3600.0,
      'hours': 8.0,
      'trips': [
        {
          'route': 'Vadodara → Jaipur',
          'customer': 'Mehta Traders',
          'amount': '₹3,600',
          'status': 'Delivered',
          'hash': '0x3a574d5...8f2c',
          'verified': true,
        }
      ],
    },
    '2026-05-29': {
      'earnings': 4800.0,
      'hours': 10.5,
      'trips': [
        {
          'route': 'Mumbai → Delhi',
          'customer': 'Raj Textiles',
          'amount': '₹3,000',
          'status': 'Delivered',
          'hash': '0x5b2b1e3...6ad1',
          'verified': true,
        },
        {
          'route': 'Delhi → Jaipur',
          'customer': 'Sharma Exports',
          'amount': '₹1,800',
          'status': 'Delivered',
          'hash': '0x9cf11a4b5e...1b39',
          'verified': true,
        }
      ],
    },
    '2026-05-30': {
      'earnings': 2000.0,
      'hours': 4.8,
      'trips': [
        {
          'route': 'Vadodara → Pune',
          'customer': 'Sri Textiles',
          'amount': '₹2,000',
          'status': 'Delivered',
          'hash': '0x9cf11a4b5e...1b39',
          'verified': true,
        }
      ],
    },
    '2026-05-31': {
      'earnings': 1200.0,
      'hours': 3.2,
      'trips': [
        {
          'route': 'Surat → Mumbai',
          'customer': 'Karthik Murugan',
          'amount': '₹1,200',
          'status': 'Delivered',
          'hash': '0x7e1a3bc...2d9e',
          'verified': true,
        }
      ],
    },

    // June 2026 daily data
    '2026-06-01': {
      'earnings': 4200.0,
      'hours': 9.0,
      'trips': [
        {
          'route': 'Surat → Jaipur',
          'customer': 'Karthik Murugan',
          'amount': '₹4,200',
          'status': 'Delivered',
          'hash': '0x3a574d5...8f2c',
          'verified': true,
        }
      ],
    },
    '2026-06-02': {
      'earnings': 3100.0,
      'hours': 7.5,
      'trips': [
        {
          'route': 'Vadodara → Mumbai',
          'customer': 'Mehta Traders',
          'amount': '₹3,100',
          'status': 'Delivered',
          'hash': '0x1aa63bce90...c901',
          'verified': true,
        }
      ],
    },
    '2026-06-03': {
      'earnings': 5400.0,
      'hours': 10.2,
      'trips': [
        {
          'route': 'Surat → Vadodara',
          'customer': 'Karthik Murugan',
          'amount': '₹5,400',
          'status': 'Delivered',
          'hash': '0x3a574d5c8f2c...31128',
          'verified': true,
        }
      ],
    },
  };

  @override
  void initState() {
    super.initState();
    // Default selected date to May 14, 2026 (a busy day with data)
    _selectedDate = DateTime(2026, 5, 14);
  }

  // Get date key format: "YYYY-MM-DD"
  String _getDateKey(DateTime date) {
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  }

  // Month navigation: previous month
  void _prevMonth() {
    setState(() {
      if (_currentMonth == 6) {
        _currentMonth = 5;
      } else {
        _currentMonth = 6;
      }
    });
  }

  // Month navigation: next month
  void _nextMonth() {
    setState(() {
      if (_currentMonth == 5) {
        _currentMonth = 6;
      } else {
        _currentMonth = 5;
      }
    });
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
    final weekday = weekdays[date.weekday - 1];
    final month = months[date.month - 1];
    return '$weekday, ${date.day} $month ${date.year}';
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: CustomScrollView(
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
                  // 1. Top Section: Row of 3 standalone overall performance summary cards showing earnings
                  _buildOverallSummaryCards(),
                  const SizedBox(height: 24),

                  // 2. Middle Section: Heatmap style calendar for date selection
                  _buildHeatmapCalendarCard(),
                  const SizedBox(height: 24),

                  // 3. Bottom Section: Detailed statistics for the selected date
                  _buildSelectedDateDetailsCard(),
                  const SizedBox(height: 24),

                  // 4. Persistent Pending Payments Card at the bottom
                  _buildPendingPaymentsCard(),
                  const SizedBox(height: 40),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOverallSummaryCards() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          _buildSummaryCard(
            value: '₹4,200',
            label: 'Today',
            icon: Icons.today_rounded,
            iconColor: TruxifyColors.accent,
            bgColor: TruxifyColors.accentLight,
          ),
          const SizedBox(width: 12),
          _buildSummaryCard(
            value: '₹18,400',
            label: 'This Week',
            icon: Icons.date_range_rounded,
            iconColor: TruxifyColors.warning,
            bgColor: TruxifyColors.warningLight,
          ),
          const SizedBox(width: 12),
          _buildSummaryCard(
            value: '₹72,500',
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
          border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
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
            color: Colors.black.withOpacity(0.02),
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
                    icon: const Icon(Icons.chevron_left_rounded, size: 20),
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
                    icon: const Icon(Icons.chevron_right_rounded, size: 20),
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

              double earnings = 0.0;
              if (_dailyData.containsKey(cellKey)) {
                earnings = _dailyData[cellKey]!['earnings'] as double;
              }

              // Determine color based on earnings magnitude relative to max ₹8,400
              Color cellBgColor = Theme.of(context).colorScheme.outlineVariant.withOpacity(0.3);
              Color textColor = Theme.of(context).colorScheme.onSurface;
              FontWeight textWeight = FontWeight.normal;

              if (earnings > 0) {
                // Scale opacity: higher earnings = darker accent color
                final double scale = (earnings / 8400.0).clamp(0.0, 1.0);
                final double opacity = 0.15 + (scale * 0.75);
                cellBgColor = TruxifyColors.accent.withOpacity(opacity);

                // For very dark cells, use white text
                if (opacity > 0.6) {
                  textColor = Colors.white;
                  textWeight = FontWeight.bold;
                } else {
                  textColor = TruxifyColors.accentDark;
                  textWeight = FontWeight.w600;
                }
              } else if (_dailyData.containsKey(cellKey) && earnings == 0.0) {
                // Cancelled day (grey card outline style)
                cellBgColor = Theme.of(context).colorScheme.outlineVariant.withOpacity(0.6);
                textColor = TruxifyColors.adaptiveSecondaryText(context);
              }

              return GestureDetector(
                onTap: () {
                  setState(() {
                    _selectedDate = cellDate;
                  });
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
              _buildLegendBox(Theme.of(context).colorScheme.outlineVariant.withOpacity(0.3)),
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
    final bool hasData = _dailyData.containsKey(dateKey);
    final data = _dailyData[dateKey];
    final double earnings = hasData ? (data!['earnings'] as double) : 0.0;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header showing selected date
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: const BoxDecoration(
                  color: TruxifyColors.accentLight,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.calendar_today_rounded,
                  color: TruxifyColors.accent,
                  size: 16,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  _formatFullDate(_selectedDate),
                  style: GoogleFonts.dmSans(
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 14),
            child: Divider(color: Theme.of(context).colorScheme.outlineVariant),
          ),

          if (hasData && earnings > 0.0) ...[
            // Daily Performance Stats Row
            Row(
              children: [
                _buildDailyMetric(
                  label: 'EARNINGS',
                  value: '₹${earnings.toInt()}',
                  icon: Icons.payments_outlined,
                  color: TruxifyColors.accent,
                ),
                _buildDailyMetric(
                  label: 'HOURS',
                  value: '${data!['hours']}h',
                  icon: Icons.timer_outlined,
                  color: TruxifyColors.adaptiveSecondaryText(context),
                ),
                _buildDailyMetric(
                  label: 'TRIPS',
                  value: '${(data['trips'] as List).length}',
                  icon: Icons.local_shipping_outlined,
                  color: TruxifyColors.success,
                ),
              ],
            ),
            const SizedBox(height: 24),

            // Completed Trips List
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

            ...(data['trips'] as List).map((trip) {
              return Container(
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Theme.of(context).scaffoldBackgroundColor.withOpacity(0.3),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: const BoxDecoration(
                            color: TruxifyColors.successLight,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.check_circle_rounded,
                            color: TruxifyColors.success,
                            size: 16,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                trip['route'] as String,
                                style: GoogleFonts.dmSans(
                                  fontSize: 14,
                                  fontWeight: FontWeight.bold,
                                  color: Theme.of(context).colorScheme.onSurface,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                trip['customer'] as String,
                                style: GoogleFonts.dmSans(
                                  fontSize: 12,
                                  color: TruxifyColors.adaptiveSecondaryText(context),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Text(
                          trip['amount'] as String,
                          style: GoogleFonts.dmSans(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: TruxifyColors.accent,
                          ),
                        ),
                      ],
                    ),
                    if (trip['verified'] == true) ...[
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        child: Divider(color: Theme.of(context).colorScheme.outlineVariant, height: 1),
                      ),
                      Row(
                        children: [
                          Icon(
                            Icons.shield_outlined,
                            color: TruxifyColors.success.withOpacity(0.8),
                            size: 12,
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              'Verified on Polygon · ${trip['hash']}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: GoogleFonts.dmSans(
                                  fontSize: 10,
                                  color: TruxifyColors.adaptiveSecondaryText(context),
                                  fontWeight: FontWeight.w500),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              );
            }),
          ] else if (hasData && earnings == 0.0) ...[
            // Cancelled trip state details
            Row(
              children: [
                _buildDailyMetric(
                  label: 'EARNINGS',
                  value: '₹0',
                  icon: Icons.payments_outlined,
                  color: TruxifyColors.accent,
                ),
                _buildDailyMetric(
                  label: 'HOURS',
                  value: '${data!['hours']}h',
                  icon: Icons.timer_outlined,
                  color: TruxifyColors.adaptiveSecondaryText(context),
                ),
                _buildDailyMetric(
                  label: 'TRIPS',
                  value: '0',
                  icon: Icons.local_shipping_outlined,
                  color: TruxifyColors.adaptiveSecondaryText(context),
                ),
              ],
            ),
            const SizedBox(height: 20),

            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: TruxifyColors.errorLight,
                borderRadius: BorderRadius.circular(16),
                border:
                    Border.all(color: TruxifyColors.error.withOpacity(0.15)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.cancel_outlined,
                          color: TruxifyColors.error, size: 20),
                      const SizedBox(width: 12),
                      Text(
                        'Trip Cancelled',
                        style: GoogleFonts.dmSans(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.error,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Load route from Vadodara → Mumbai was cancelled before pickup. Platform cancellation insurance was processed.',
                    style: GoogleFonts.dmSans(
                      fontSize: 12,
                      color: TruxifyColors.adaptiveSecondaryText(context),
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Transaction: ${(data['trips'] as List).isNotEmpty ? data['trips'][0]['hash'] : 'N/A'}',
                    style: GoogleFonts.dmSans(
                      fontSize: 10,
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
                  ),
                ],
              ),
            ),
          ] else ...[
            // Rest Day State
            Center(
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
                child: Column(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: const BoxDecoration(
                        color: TruxifyColors.accentVeryLight,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.spa_outlined,
                        color: TruxifyColors.accent,
                        size: 32,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Rest Day',
                      style: GoogleFonts.dmSans(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                        color: Theme.of(context).colorScheme.onSurface,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'No trips completed on this date. Take the time to rest, perform maintenance, or search for en-route loads.',
                      textAlign: TextAlign.center,
                      style: GoogleFonts.dmSans(
                        fontSize: 12,
                        color: TruxifyColors.adaptiveSecondaryText(context),
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
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
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
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
              Text(
                'Pending Payments',
                style: GoogleFonts.dmSans(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: TruxifyColors.accentLight,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '₹4,700',
                  style: GoogleFonts.dmSans(
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    color: TruxifyColors.accent,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ...pendingPayments.map((item) {
            final joinedNames = item.customerName
                .split(' ')
                .map((e) => e.isNotEmpty ? e[0] : '')
                .join('');
            final initials = joinedNames.length > 2
                ? joinedNames.substring(0, 2).toUpperCase()
                : joinedNames.toUpperCase();

            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 12.0),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      color: TruxifyColors.accentVeryLight,
                    ),
                    child: Center(
                      child: Text(
                        initials.isNotEmpty ? initials : 'C',
                        style: GoogleFonts.dmSans(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.accent,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.customerName,
                          style: GoogleFonts.dmSans(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            color: Theme.of(context).colorScheme.onSurface,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${item.route} · ${item.note}',
                          style: GoogleFonts.dmSans(
                            fontSize: 12,
                            color: TruxifyColors.adaptiveSecondaryText(context),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    item.amount,
                    style: GoogleFonts.dmSans(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}
