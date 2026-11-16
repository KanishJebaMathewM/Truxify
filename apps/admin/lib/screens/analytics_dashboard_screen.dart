import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../main.dart';

// ============================================================================
// DATA MODELS
// ============================================================================

class AnalyticsOverview {
  final int totalBookingsToday;
  final int totalBookingsYesterday;
  final double bookingsDeltaPct;
  final double grossRevenueToday;
  final double grossRevenueYesterday;
  final double revenueDeltaPct;
  final int activeDrivers24h;
  final int activeDriversPrev24h;
  final double activeDriversDeltaPct;
  final int openDisputes;
  final int openDisputesYesterday;
  final double disputesDeltaPct;

  const AnalyticsOverview({
    required this.totalBookingsToday,
    required this.totalBookingsYesterday,
    required this.bookingsDeltaPct,
    required this.grossRevenueToday,
    required this.grossRevenueYesterday,
    required this.revenueDeltaPct,
    required this.activeDrivers24h,
    required this.activeDriversPrev24h,
    required this.activeDriversDeltaPct,
    required this.openDisputes,
    required this.openDisputesYesterday,
    required this.disputesDeltaPct,
  });

  factory AnalyticsOverview.fromJson(Map<String, dynamic> json) {
    return AnalyticsOverview(
      totalBookingsToday: (json['total_bookings_today'] as num?)?.toInt() ?? 0,
      totalBookingsYesterday: (json['total_bookings_yesterday'] as num?)?.toInt() ?? 0,
      bookingsDeltaPct: (json['bookings_delta_pct'] as num?)?.toDouble() ?? 0.0,
      grossRevenueToday: (json['gross_revenue_today'] as num?)?.toDouble() ?? 0.0,
      grossRevenueYesterday: (json['gross_revenue_yesterday'] as num?)?.toDouble() ?? 0.0,
      revenueDeltaPct: (json['revenue_delta_pct'] as num?)?.toDouble() ?? 0.0,
      activeDrivers24h: (json['active_drivers_24h'] as num?)?.toInt() ?? 0,
      activeDriversPrev24h: (json['active_drivers_prev_24h'] as num?)?.toInt() ?? 0,
      activeDriversDeltaPct: (json['active_drivers_delta_pct'] as num?)?.toDouble() ?? 0.0,
      openDisputes: (json['open_disputes'] as num?)?.toInt() ?? 0,
      openDisputesYesterday: (json['open_disputes_yesterday'] as num?)?.toInt() ?? 0,
      disputesDeltaPct: (json['disputes_delta_pct'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class BookingVolumeDay {
  final String date;
  final int count;
  final String dayName;

  const BookingVolumeDay({
    required this.date,
    required this.count,
    required this.dayName,
  });

  factory BookingVolumeDay.fromJson(Map<String, dynamic> json) {
    return BookingVolumeDay(
      date: json['date'] as String? ?? '',
      count: (json['count'] as num?)?.toInt() ?? 0,
      dayName: json['day_name'] as String? ?? '',
    );
  }
}

class RevenueTrendDay {
  final String date;
  final double revenue;

  const RevenueTrendDay({
    required this.date,
    required this.revenue,
  });

  factory RevenueTrendDay.fromJson(Map<String, dynamic> json) {
    return RevenueTrendDay(
      date: json['date'] as String? ?? '',
      revenue: (json['revenue'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class DriverHeatmapPoint {
  final String driverId;
  final double lat;
  final double lng;
  final double speed;
  final double weight;
  final String region;
  final String lastPing;

  const DriverHeatmapPoint({
    required this.driverId,
    required this.lat,
    required this.lng,
    required this.speed,
    required this.weight,
    required this.region,
    required this.lastPing,
  });

  factory DriverHeatmapPoint.fromJson(Map<String, dynamic> json) {
    return DriverHeatmapPoint(
      driverId: json['driver_id']?.toString() ?? '',
      lat: (json['lat'] as num?)?.toDouble() ?? 0.0,
      lng: (json['lng'] as num?)?.toDouble() ?? 0.0,
      speed: (json['speed'] as num?)?.toDouble() ?? 0.0,
      weight: (json['weight'] as num?)?.toDouble() ?? 0.5,
      region: json['region']?.toString() ?? 'Central',
      lastPing: json['last_ping']?.toString() ?? '',
    );
  }
}

class RegionDensity {
  final String name;
  final double lat;
  final double lng;
  final int count;

  const RegionDensity({
    required this.name,
    required this.lat,
    required this.lng,
    required this.count,
  });

  factory RegionDensity.fromJson(Map<String, dynamic> json) {
    return RegionDensity(
      name: json['name'] as String? ?? '',
      lat: (json['lat'] as num?)?.toDouble() ?? 0.0,
      lng: (json['lng'] as num?)?.toDouble() ?? 0.0,
      count: (json['count'] as num?)?.toInt() ?? 0,
    );
  }
}

class DisputeMetrics {
  final double disputeRatePct;
  final int totalBookings30d;
  final int disputedBookings30d;
  final int openDisputes;
  final double avgResolutionHours;

  const DisputeMetrics({
    required this.disputeRatePct,
    required this.totalBookings30d,
    required this.disputedBookings30d,
    required this.openDisputes,
    required this.avgResolutionHours,
  });

  factory DisputeMetrics.fromJson(Map<String, dynamic> json) {
    return DisputeMetrics(
      disputeRatePct: (json['dispute_rate_pct'] as num?)?.toDouble() ?? 0.0,
      totalBookings30d: (json['total_bookings_30d'] as num?)?.toInt() ?? 0,
      disputedBookings30d: (json['disputed_bookings_30d'] as num?)?.toInt() ?? 0,
      openDisputes: (json['open_disputes'] as num?)?.toInt() ?? 0,
      avgResolutionHours: (json['avg_resolution_hours'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class MLTripAccuracy {
  final String tripId;
  final String route;
  final String predictedEta;
  final String actualEta;
  final int diffMinutes;
  final String status;
  final String completedAt;

  const MLTripAccuracy({
    required this.tripId,
    required this.route,
    required this.predictedEta,
    required this.actualEta,
    required this.diffMinutes,
    required this.status,
    required this.completedAt,
  });

  factory MLTripAccuracy.fromJson(Map<String, dynamic> json) {
    return MLTripAccuracy(
      tripId: json['trip_id'] as String? ?? '',
      route: json['route'] as String? ?? '',
      predictedEta: json['predicted_eta'] as String? ?? '',
      actualEta: json['actual_eta'] as String? ?? '',
      diffMinutes: (json['diff_minutes'] as num?)?.toInt() ?? 0,
      status: json['status'] as String? ?? 'On-Time',
      completedAt: json['completed_at'] as String? ?? '',
    );
  }
}

class MLAccuracySummary {
  final int tripsEvaluated;
  final double maeMinutes;
  final double within15mPct;
  final List<MLTripAccuracy> trips;

  const MLAccuracySummary({
    required this.tripsEvaluated,
    required this.maeMinutes,
    required this.within15mPct,
    required this.trips,
  });

  factory MLAccuracySummary.fromJson(Map<String, dynamic> json) {
    final rawTrips = json['trips'] as List<dynamic>? ?? [];
    return MLAccuracySummary(
      tripsEvaluated: (json['trips_evaluated'] as num?)?.toInt() ?? 0,
      maeMinutes: (json['mae_minutes'] as num?)?.toDouble() ?? 0.0,
      within15mPct: (json['within_15m_pct'] as num?)?.toDouble() ?? 0.0,
      trips: rawTrips
          .map((t) => MLTripAccuracy.fromJson(t as Map<String, dynamic>))
          .toList(),
    );
  }
}

class AnalyticsData {
  final String period;
  final AnalyticsOverview overview;
  final List<BookingVolumeDay> bookingVolume;
  final List<RevenueTrendDay> revenueTrend;
  final int totalActiveDrivers;
  final List<RegionDensity> regions;
  final List<DriverHeatmapPoint> heatmapPoints;
  final DisputeMetrics disputeMetrics;
  final MLAccuracySummary mlAccuracy;

  const AnalyticsData({
    required this.period,
    required this.overview,
    required this.bookingVolume,
    required this.revenueTrend,
    required this.totalActiveDrivers,
    required this.regions,
    required this.heatmapPoints,
    required this.disputeMetrics,
    required this.mlAccuracy,
  });

  factory AnalyticsData.fromJson(Map<String, dynamic> json) {
    final mapObj = json['active_drivers_map'] as Map<String, dynamic>? ?? {};
    final rawRegions = mapObj['regions'] as List<dynamic>? ?? [];
    final rawPoints = mapObj['points'] as List<dynamic>? ?? [];
    final rawVolume = json['booking_volume'] as List<dynamic>? ?? [];
    final rawRev = json['revenue_trend'] as List<dynamic>? ?? [];

    return AnalyticsData(
      period: json['period'] as String? ?? '7d',
      overview: AnalyticsOverview.fromJson(json['overview'] as Map<String, dynamic>? ?? {}),
      bookingVolume: rawVolume.map((v) => BookingVolumeDay.fromJson(v as Map<String, dynamic>)).toList(),
      revenueTrend: rawRev.map((r) => RevenueTrendDay.fromJson(r as Map<String, dynamic>)).toList(),
      totalActiveDrivers: (mapObj['total_active'] as num?)?.toInt() ?? 0,
      regions: rawRegions.map((r) => RegionDensity.fromJson(r as Map<String, dynamic>)).toList(),
      heatmapPoints: rawPoints.map((p) => DriverHeatmapPoint.fromJson(p as Map<String, dynamic>)).toList(),
      disputeMetrics: DisputeMetrics.fromJson(json['dispute_metrics'] as Map<String, dynamic>? ?? {}),
      mlAccuracy: MLAccuracySummary.fromJson(json['ml_accuracy'] as Map<String, dynamic>? ?? {}),
    );
  }
}

// ============================================================================
// MAIN SCREEN WIDGET
// ============================================================================

class AnalyticsDashboardScreen extends StatefulWidget {
  final String? customBaseUrl;
  final String? customAuthToken;

  const AnalyticsDashboardScreen({
    super.key,
    this.customBaseUrl,
    this.customAuthToken,
  });

  @override
  State<AnalyticsDashboardScreen> createState() => _AnalyticsDashboardScreenState();
}

class _AnalyticsDashboardScreenState extends State<AnalyticsDashboardScreen> {
  String _selectedPeriod = '7d';
  bool _isLoading = true;
  String _errorMessage = '';
  AnalyticsData? _data;
  DateTime _lastRefreshed = DateTime.now();

  // ML table filtering & pagination
  String _mlStatusFilter = 'All';
  String _mlSearchQuery = '';
  int _mlCurrentPage = 0;
  static const int _mlPageSize = 10;

  // Region filter for Heatmap
  String _selectedRegion = 'All';

  @override
  void initState() {
    super.initState();
    _fetchAnalytics();
  }

  String get _effectiveBaseUrl {
    if (widget.customBaseUrl != null && widget.customBaseUrl!.isNotEmpty) {
      return widget.customBaseUrl!;
    }
    return AdminApiConfig.baseUrl;
  }

  String? get _effectiveAuthToken {
    return widget.customAuthToken ?? AdminApiConfig.authToken;
  }

  Future<void> _fetchAnalytics() async {
    setState(() {
      _isLoading = true;
      _errorMessage = '';
    });

    try {
      final uri = Uri.parse('$_effectiveBaseUrl/api/admin/analytics?period=$_selectedPeriod');
      final headers = <String, String>{
        'Content-Type': 'application/json',
        if (_effectiveAuthToken != null)
          'Authorization': 'Bearer $_effectiveAuthToken',
      };

      final response = await http.get(uri, headers: headers).timeout(
        const Duration(seconds: 15),
      );

      if (response.statusCode == 200) {
        final decoded = json.decode(response.body) as Map<String, dynamic>;
        setState(() {
          _data = AnalyticsData.fromJson(decoded);
          _isLoading = false;
          _lastRefreshed = DateTime.now();
        });
      } else {
        setState(() {
          _errorMessage = 'Server error (${response.statusCode}): ${response.body}';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Failed to load analytics: $e';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _fetchAnalytics,
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildHeader(theme),
                const SizedBox(height: 20),
                if (_isLoading)
                  _buildLoadingState()
                else if (_errorMessage.isNotEmpty)
                  _buildErrorState(theme)
                else if (_data != null) ...[
                  _buildOverviewCards(_data!.overview),
                  const SizedBox(height: 24),
                  _buildChartsRow(_data!),
                  const SizedBox(height: 24),
                  _buildActiveDriversMapSection(_data!),
                  const SizedBox(height: 24),
                  _buildDisputeSection(_data!.disputeMetrics),
                  const SizedBox(height: 24),
                  _buildMlAccuracySection(_data!.mlAccuracy),
                  const SizedBox(height: 40),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ==========================================================================
  // HEADER
  // ==========================================================================

  Widget _buildHeader(ThemeData theme) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Colors.indigo.shade50,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.analytics_rounded, color: Colors.indigo, size: 28),
                  ),
                  const SizedBox(width: 12),
                  const Text(
                    'Platform Analytics Dashboard',
                    style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF0F172A),
                      letterSpacing: -0.5,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                'Volume trends, platform revenue, regional driver density, dispute rates & ML accuracy',
                style: TextStyle(color: Colors.blueGrey.shade600, fontSize: 14),
              ),
            ],
          ),
        ),
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 12,
          runSpacing: 8,
          children: [
            _buildPeriodSelector(),
            IconButton.filledTonal(
              onPressed: _isLoading ? null : _fetchAnalytics,
              tooltip: 'Refresh analytics',
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildPeriodSelector() {
    const periods = ['24h', '7d', '30d', '90d'];
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.shade300),
      ),
      padding: const EdgeInsets.all(4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: periods.map((p) {
          final isSelected = _selectedPeriod == p;
          return InkWell(
            onTap: () {
              if (_selectedPeriod != p) {
                setState(() {
                  _selectedPeriod = p;
                });
                _fetchAnalytics();
              }
            },
            borderRadius: BorderRadius.circular(8),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                color: isSelected ? Colors.indigo : Colors.transparent,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                p.toUpperCase(),
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: isSelected ? Colors.white : Colors.blueGrey.shade700,
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  // ==========================================================================
  // OVERVIEW CARDS (Today vs Yesterday delta)
  // ==========================================================================

  Widget _buildOverviewCards(AnalyticsOverview o) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final crossAxisCount = constraints.maxWidth > 1100 ? 4 : (constraints.maxWidth > 650 ? 2 : 1);
        return GridView.count(
          crossAxisCount: crossAxisCount,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 16,
          crossAxisSpacing: 16,
          childAspectRatio: crossAxisCount == 4 ? 1.6 : (crossAxisCount == 2 ? 1.9 : 2.4),
          children: [
            _buildKpiCard(
              title: 'Total Bookings Today',
              value: '${o.totalBookingsToday}',
              subValue: '${o.totalBookingsYesterday} yesterday',
              delta: o.bookingsDeltaPct,
              icon: Icons.local_shipping_rounded,
              accentColor: Colors.blue,
            ),
            _buildKpiCard(
              title: 'Gross Platform Revenue',
              value: '₹${_formatCurrency(o.grossRevenueToday)}',
              subValue: '₹${_formatCurrency(o.grossRevenueYesterday)} yesterday',
              delta: o.revenueDeltaPct,
              icon: Icons.account_balance_wallet_rounded,
              accentColor: Colors.emeraldGreen,
            ),
            _buildKpiCard(
              title: 'Active Drivers (24h)',
              value: '${o.activeDrivers24h}',
              subValue: '${o.activeDriversPrev24h} prev 24h',
              delta: o.activeDriversDeltaPct,
              icon: Icons.person_pin_circle_rounded,
              accentColor: Colors.indigo,
            ),
            _buildKpiCard(
              title: 'Open Disputes',
              value: '${o.openDisputes}',
              subValue: o.openDisputes == 0 ? 'All resolved' : 'Requires attention',
              delta: o.disputesDeltaPct,
              isInverseDelta: true,
              icon: Icons.gavel_rounded,
              accentColor: Colors.amber.shade800,
            ),
          ],
        );
      },
    );
  }

  Widget _buildKpiCard({
    required String title,
    required String value,
    required String subValue,
    required double delta,
    required IconData icon,
    required Color accentColor,
    bool isInverseDelta = false,
  }) {
    final isPositive = delta > 0;
    final isZero = delta == 0;
    final deltaGood = isInverseDelta ? !isPositive : isPositive;
    final deltaColor = isZero
        ? Colors.grey.shade600
        : (deltaGood ? Colors.emeraldGreen : Colors.roseRed);

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey.shade200),
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
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: Colors.blueGrey.shade600,
                ),
              ),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: accentColor.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: accentColor, size: 20),
              ),
            ],
          ),
          Text(
            value,
            style: const TextStyle(
              fontSize: 26,
              fontWeight: FontWeight.bold,
              color: Color(0xFF0F172A),
              letterSpacing: -0.5,
            ),
          ),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: deltaColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      isZero
                          ? Icons.remove_rounded
                          : (isPositive ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded),
                      color: deltaColor,
                      size: 13,
                    ),
                    const SizedBox(width: 2),
                    Text(
                      '${delta.abs().toStringAsFixed(1)}%',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: deltaColor,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  subValue,
                  style: TextStyle(fontSize: 11, color: Colors.blueGrey.shade400),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ==========================================================================
  // CHARTS ROW (7-Day Booking Volume Bar & 30-Day Revenue Trend Line)
  // ==========================================================================

  Widget _buildChartsRow(AnalyticsData data) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isNarrow = constraints.maxWidth < 900;
        final chartHeight = 280.0;

        final volumeCard = _buildCardShell(
          title: 'Booking Volume (Last 7 Days)',
          subtitle: 'Daily platform completed & en route bookings',
          trailing: const Icon(Icons.bar_chart_rounded, color: Colors.indigo),
          child: SizedBox(
            height: chartHeight,
            child: BookingVolumeBarChart(days: data.bookingVolume),
          ),
        );

        final revenueCard = _buildCardShell(
          title: 'Gross Platform Revenue (Last 30 Days)',
          subtitle: 'Daily gross freight volume in Indian Rupees (₹)',
          trailing: const Icon(Icons.show_chart_rounded, color: Colors.teal),
          child: SizedBox(
            height: chartHeight,
            child: RevenueTrendLineChart(days: data.revenueTrend),
          ),
        );

        if (isNarrow) {
          return Column(
            children: [
              volumeCard,
              const SizedBox(height: 20),
              revenueCard,
            ],
          );
        }

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: volumeCard),
            const SizedBox(width: 20),
            Expanded(child: revenueCard),
          ],
        );
      },
    );
  }

  // ==========================================================================
  // ACTIVE DRIVERS HEATMAP (OpenStreetMap overlay)
  // ==========================================================================

  Widget _buildActiveDriversMapSection(AnalyticsData data) {
    final filteredPoints = _selectedRegion == 'All'
        ? data.heatmapPoints
        : data.heatmapPoints.where((p) => p.region == _selectedRegion).toList();

    return _buildCardShell(
      title: 'Active Drivers Density Heatmap (OpenStreetMap)',
      subtitle: 'Real-time telemetry & activity pings across key transport corridors',
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.indigo.shade50,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              '${data.totalActiveDrivers} Active Drivers',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: Colors.indigo.shade700,
              ),
            ),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Region filter chips
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: ['All', 'North', 'West', 'South', 'East', 'Central'].map((reg) {
              final isSel = _selectedRegion == reg;
              final regCount = reg == 'All'
                  ? data.totalActiveDrivers
                  : (data.regions.firstWhere((r) => r.name == reg, orElse: () => RegionDensity(name: reg, lat: 0, lng: 0, count: 0)).count);

              return ChoiceChip(
                label: Text('$reg ($regCount)'),
                selected: isSel,
                onSelected: (val) {
                  setState(() {
                    _selectedRegion = reg;
                  });
                },
                selectedColor: Colors.indigo.shade100,
                labelStyle: TextStyle(
                  fontSize: 12,
                  fontWeight: isSel ? FontWeight.bold : FontWeight.normal,
                  color: isSel ? Colors.indigo.shade900 : Colors.blueGrey.shade700,
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 16),
          // Interactive OSM Map Widget with Heatmap Canvas Overlay
          OsmHeatmapWidget(
            points: filteredPoints,
            selectedRegion: _selectedRegion,
          ),
          const SizedBox(height: 12),
          // Density scale legend
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Text('Density: ', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                  Container(
                    width: 140,
                    height: 10,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(5),
                      gradient: const LinearGradient(
                        colors: [
                          Colors.blue,
                          Colors.cyan,
                          Colors.green,
                          Colors.amber,
                          Colors.red,
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text('Low → High', style: TextStyle(fontSize: 11, color: Colors.blueGrey.shade600)),
                ],
              ),
              Text(
                'Map data © OpenStreetMap contributors',
                style: TextStyle(fontSize: 11, color: Colors.blueGrey.shade400),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ==========================================================================
  // DISPUTE RATE SECTION
  // ==========================================================================

  Widget _buildDisputeSection(DisputeMetrics d) {
    final isHealthy = d.disputeRatePct < 2.5;

    return _buildCardShell(
      title: 'Dispute Rate & Escalations (Last 30 Days)',
      subtitle: '% of platform bookings that triggered an escrow or quality dispute',
      trailing: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: (isHealthy ? Colors.emeraldGreen : Colors.roseRed).withOpacity(0.12),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          isHealthy ? 'Healthy (<2.5%)' : 'Elevated (>2.5%)',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.bold,
            color: isHealthy ? Colors.emeraldGreen : Colors.roseRed,
          ),
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final isNarrow = constraints.maxWidth < 650;
          return Column(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  // Gauge / Circular Rate
                  SizedBox(
                    width: 110,
                    height: 110,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        CircularProgressIndicator(
                          value: (d.disputeRatePct / 10).clamp(0.0, 1.0),
                          strokeWidth: 10,
                          backgroundColor: Colors.grey.shade200,
                          color: isHealthy ? Colors.indigo : Colors.roseRed,
                        ),
                        Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              '${d.disputeRatePct.toStringAsFixed(1)}%',
                              style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF0F172A),
                              ),
                            ),
                            Text(
                              'Dispute Rate',
                              style: TextStyle(fontSize: 10, color: Colors.blueGrey.shade500),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 24),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${d.disputedBookings30d} disputes raised out of ${d.totalBookings30d} total bookings in the last 30 days.',
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: Color(0xFF1E293B),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Average resolution time: ${d.avgResolutionHours.toStringAsFixed(1)} hours. Disputed escrows remain frozen on smart contract until mediated.',
                          style: TextStyle(fontSize: 13, color: Colors.blueGrey.shade600),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              const Divider(),
              const SizedBox(height: 8),
              Wrap(
                spacing: 24,
                runSpacing: 12,
                children: [
                  _buildMetricPill('Total Bookings (30d)', '${d.totalBookings30d}'),
                  _buildMetricPill('Disputed Bookings', '${d.disputedBookings30d}'),
                  _buildMetricPill('Currently Open Disputes', '${d.openDisputes}'),
                  _buildMetricPill('Avg Resolution Time', '${d.avgResolutionHours.toStringAsFixed(1)}h'),
                ],
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildMetricPill(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(fontSize: 11, color: Colors.blueGrey.shade400)),
        const SizedBox(height: 2),
        Text(value, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
      ],
    );
  }

  // ==========================================================================
  // ML ACCURACY TABLE (Actual vs Predicted ETA for last 100 trips)
  // ==========================================================================

  Widget _buildMlAccuracySection(MLAccuracySummary ml) {
    // Filter & search
    final filtered = ml.trips.where((t) {
      if (_mlStatusFilter != 'All' && t.status != _mlStatusFilter) {
        return false;
      }
      if (_mlSearchQuery.isNotEmpty) {
        final q = _mlSearchQuery.toLowerCase();
        return t.tripId.toLowerCase().contains(q) || t.route.toLowerCase().contains(q);
      }
      return true;
    }).toList();

    final totalPages = (filtered.length / _mlPageSize).ceil().clamp(1, 999);
    final pageIndex = _mlCurrentPage.clamp(0, totalPages - 1);
    final pagedTrips = filtered.skip(pageIndex * _mlPageSize).take(_mlPageSize).toList();

    return _buildCardShell(
      title: 'ML Model Performance & ETA Accuracy (Last 100 Completed Trips)',
      subtitle: 'Predicted vs actual delivery ETA monitoring to identify routing drift & model calibration',
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.indigo.shade50,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              '${ml.tripsEvaluated} Evaluated Trips',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: Colors.indigo.shade700,
              ),
            ),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // KPI summary row
          Wrap(
            spacing: 20,
            runSpacing: 12,
            children: [
              _buildMlSummaryCard('Mean Absolute Error (MAE)', '${ml.maeMinutes.toStringAsFixed(1)} min', Icons.timer_outlined, Colors.indigo),
              _buildMlSummaryCard('On-Time Accuracy (±15m)', '${ml.within15mPct.toStringAsFixed(1)}%', Icons.check_circle_outline_rounded, Colors.emeraldGreen),
              _buildMlSummaryCard('Evaluated Dataset', '${ml.tripsEvaluated} trips', Icons.storage_rounded, Colors.blue),
            ],
          ),
          const SizedBox(height: 20),
          // Search & Filter controls
          Row(
            children: [
              Expanded(
                child: SizedBox(
                  height: 40,
                  child: TextField(
                    onChanged: (val) {
                      setState(() {
                        _mlSearchQuery = val;
                        _mlCurrentPage = 0;
                      });
                    },
                    decoration: InputDecoration(
                      hintText: 'Search by Trip ID or Corridor...',
                      prefixIcon: const Icon(Icons.search_rounded, size: 20),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide(color: Colors.grey.shade300),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Wrap(
                spacing: 6,
                children: ['All', 'On-Time', 'Delayed', 'Early'].map((st) {
                  final isSel = _mlStatusFilter == st;
                  return ChoiceChip(
                    label: Text(st),
                    selected: isSel,
                    onSelected: (val) {
                      setState(() {
                        _mlStatusFilter = st;
                        _mlCurrentPage = 0;
                      });
                    },
                  );
                }).toList(),
              ),
            ],
          ),
          const SizedBox(height: 16),
          // Table
          if (pagedTrips.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 32),
              child: Center(child: Text('No completed trips match the selected filter.')),
            )
          else
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                headingRowColor: WidgetStateProperty.all(Colors.grey.shade50),
                columns: const [
                  DataColumn(label: Text('Trip ID', style: TextStyle(fontWeight: FontWeight.bold))),
                  DataColumn(label: Text('Corridor / Route', style: TextStyle(fontWeight: FontWeight.bold))),
                  DataColumn(label: Text('Predicted ETA', style: TextStyle(fontWeight: FontWeight.bold))),
                  DataColumn(label: Text('Actual Arrival', style: TextStyle(fontWeight: FontWeight.bold))),
                  DataColumn(label: Text('Variance (Drift)', style: TextStyle(fontWeight: FontWeight.bold))),
                  DataColumn(label: Text('Outcome', style: TextStyle(fontWeight: FontWeight.bold))),
                ],
                rows: pagedTrips.map((trip) {
                  final statusColor = trip.status == 'On-Time'
                      ? Colors.emeraldGreen
                      : (trip.status == 'Delayed' ? Colors.roseRed : Colors.blue);

                  final diffFormatted = trip.diffMinutes >= 0
                      ? '+${trip.diffMinutes} min'
                      : '${trip.diffMinutes} min';

                  return DataRow(
                    cells: [
                      DataCell(Text(trip.tripId, style: const TextStyle(fontWeight: FontWeight.w600))),
                      DataCell(Text(trip.route)),
                      DataCell(Text(_formatDateTime(trip.predictedEta))),
                      DataCell(Text(_formatDateTime(trip.actualEta))),
                      DataCell(
                        Text(
                          diffFormatted,
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: trip.diffMinutes.abs() > 15 ? Colors.roseRed : Colors.blueGrey.shade800,
                          ),
                        ),
                      ),
                      DataCell(
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: statusColor.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            trip.status,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: statusColor,
                            ),
                          ),
                        ),
                      ),
                    ],
                  );
                }).toList(),
              ),
            ),
          const SizedBox(height: 12),
          // Pagination footer
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Showing ${filtered.isEmpty ? 0 : pageIndex * _mlPageSize + 1} to ${math.min((pageIndex + 1) * _mlPageSize, filtered.length)} of ${filtered.length} entries',
                style: TextStyle(fontSize: 12, color: Colors.blueGrey.shade600),
              ),
              Row(
                children: [
                  IconButton(
                    onPressed: pageIndex > 0
                        ? () {
                            setState(() {
                              _mlCurrentPage--;
                            });
                          }
                        : null,
                    icon: const Icon(Icons.chevron_left_rounded),
                  ),
                  Text('Page ${pageIndex + 1} of $totalPages', style: const TextStyle(fontSize: 12)),
                  IconButton(
                    onPressed: pageIndex < totalPages - 1
                        ? () {
                            setState(() {
                              _mlCurrentPage++;
                            });
                          }
                        : null,
                    icon: const Icon(Icons.chevron_right_rounded),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMlSummaryCard(String title, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.06),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: TextStyle(fontSize: 11, color: Colors.blueGrey.shade600)),
              Text(
                value,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: color,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ==========================================================================
  // COMMON HELPERS & CARD SHELL
  // ==========================================================================

  Widget _buildCardShell({
    required String title,
    required String subtitle,
    Widget? trailing,
    required Widget child,
  }) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.grey.shade200),
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
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF0F172A),
                        letterSpacing: -0.3,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: TextStyle(fontSize: 12, color: Colors.blueGrey.shade500),
                    ),
                  ],
                ),
              ),
              if (trailing != null) trailing,
            ],
          ),
          const SizedBox(height: 18),
          child,
        ],
      ),
    );
  }

  Widget _buildLoadingState() {
    return Container(
      height: 380,
      alignment: Alignment.center,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(
            'Aggregating metrics across Supabase & MongoDB clusters...',
            style: TextStyle(color: Colors.blueGrey.shade600, fontSize: 14),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorState(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.roseRed.shade200),
      ),
      child: Center(
        child: Column(
          children: [
            Icon(Icons.cloud_off_rounded, color: Colors.roseRed, size: 48),
            const SizedBox(height: 12),
            const Text(
              'Error Loading Analytics',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              _errorMessage,
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.blueGrey.shade700, fontSize: 13),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _fetchAnalytics,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }

  String _formatCurrency(double amount) {
    final integerPart = amount.round();
    final str = integerPart.toString();
    final buffer = StringBuffer();
    int count = 0;
    for (int i = str.length - 1; i >= 0; i--) {
      buffer.write(str[i]);
      count++;
      if (count == 3 && i > 0) {
        buffer.write(',');
      } else if (count > 3 && (count - 3) % 2 == 0 && i > 0) {
        buffer.write(',');
      }
    }
    return buffer.toString().split('').reversed.join('');
  }

  String _formatDateTime(String iso) {
    try {
      final dt = DateTime.parse(iso).toLocal();
      final h = dt.hour.toString().padLeft(2, '0');
      final m = dt.minute.toString().padLeft(2, '0');
      return '${dt.day}/${dt.month} $h:$m';
    } catch (_) {
      return iso;
    }
  }
}

// ============================================================================
// CUSTOM COLOR EXTENSIONS
// ============================================================================

extension ColorExtensions on Colors {
  static const Color emeraldGreen = Color(0xFF10B981);
  static const Color roseRed = Color(0xFFEF4444);
}

// ============================================================================
// 7-DAY BOOKING VOLUME BAR CHART (Custom Paint)
// ============================================================================

class BookingVolumeBarChart extends StatelessWidget {
  final List<BookingVolumeDay> days;

  const BookingVolumeBarChart({super.key, required this.days});

  @override
  Widget build(BuildContext context) {
    if (days.isEmpty) {
      return const Center(child: Text('No booking volume data'));
    }

    final maxVal = days.map((d) => d.count).fold<int>(0, math.max);
    final ceiling = maxVal == 0 ? 10 : ((maxVal / 5).ceil() * 5);

    return LayoutBuilder(
      builder: (context, constraints) {
        return CustomPaint(
          size: Size(constraints.maxWidth, constraints.maxHeight),
          painter: _BarChartPainter(days: days, ceiling: ceiling),
        );
      },
    );
  }
}

class _BarChartPainter extends CustomPainter {
  final List<BookingVolumeDay> days;
  final int ceiling;

  _BarChartPainter({required this.days, required this.ceiling});

  @override
  void paint(Canvas canvas, Size size) {
    final bottomPadding = 32.0;
    final topPadding = 24.0;
    final leftPadding = 36.0;
    final rightPadding = 16.0;

    final chartWidth = size.width - leftPadding - rightPadding;
    final chartHeight = size.height - bottomPadding - topPadding;

    final gridPaint = Paint()
      ..color = Colors.grey.shade200
      ..strokeWidth = 1.0;

    final textStyle = TextStyle(fontSize: 10, color: Colors.blueGrey.shade400);

    // Y Axis grid lines & labels
    final steps = 4;
    for (int i = 0; i <= steps; i++) {
      final val = (ceiling * (i / steps)).round();
      final y = topPadding + chartHeight - (chartHeight * (i / steps));

      canvas.drawLine(Offset(leftPadding, y), Offset(size.width - rightPadding, y), gridPaint);

      final textSpan = TextSpan(text: '$val', style: textStyle);
      final textPainter = TextPainter(text: textSpan, textDirection: TextDirection.ltr);
      textPainter.layout();
      textPainter.paint(canvas, Offset(leftPadding - textPainter.width - 6, y - textPainter.height / 2));
    }

    if (days.isEmpty) return;

    final barGroupWidth = chartWidth / days.length;
    final barWidth = math.min(36.0, barGroupWidth * 0.55);

    for (int i = 0; i < days.length; i++) {
      final day = days[i];
      final x = leftPadding + (i * barGroupWidth) + (barGroupWidth / 2);
      final barHeight = ceiling > 0 ? (day.count / ceiling) * chartHeight : 0.0;
      final y = topPadding + chartHeight - barHeight;

      // Bar gradient paint
      final rect = Rect.fromLTWH(x - barWidth / 2, y, barWidth, barHeight);
      final barPaint = Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF6366F1), Color(0xFF4F46E5)],
        ).createShader(rect);

      // Draw rounded bar
      final rrect = RRect.fromRectAndRadius(rect, const Radius.circular(6));
      canvas.drawRRect(rrect, barPaint);

      // Value label on top of bar
      if (day.count > 0) {
        final valSpan = TextSpan(
          text: '${day.count}',
          style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF4F46E5)),
        );
        final valPainter = TextPainter(text: valSpan, textDirection: TextDirection.ltr);
        valPainter.layout();
        valPainter.paint(canvas, Offset(x - valPainter.width / 2, y - valPainter.height - 3));
      }

      // X Axis label (Day name)
      final labelSpan = TextSpan(text: day.dayName, style: textStyle);
      final labelPainter = TextPainter(text: labelSpan, textDirection: TextDirection.ltr);
      labelPainter.layout();
      labelPainter.paint(canvas, Offset(x - labelPainter.width / 2, topPadding + chartHeight + 8));
    }
  }

  @override
  bool shouldRepaint(covariant _BarChartPainter oldDelegate) => true;
}

// ============================================================================
// 30-DAY REVENUE TREND LINE CHART (Custom Paint)
// ============================================================================

class RevenueTrendLineChart extends StatelessWidget {
  final List<RevenueTrendDay> days;

  const RevenueTrendLineChart({super.key, required this.days});

  @override
  Widget build(BuildContext context) {
    if (days.isEmpty) {
      return const Center(child: Text('No revenue trend data'));
    }

    final maxVal = days.map((d) => d.revenue).fold<double>(0.0, math.max);
    final ceiling = maxVal == 0 ? 10000.0 : ((maxVal / 5000).ceil() * 5000.0);

    return LayoutBuilder(
      builder: (context, constraints) {
        return CustomPaint(
          size: Size(constraints.maxWidth, constraints.maxHeight),
          painter: _LineChartPainter(days: days, ceiling: ceiling),
        );
      },
    );
  }
}

class _LineChartPainter extends CustomPainter {
  final List<RevenueTrendDay> days;
  final double ceiling;

  _LineChartPainter({required this.days, required this.ceiling});

  @override
  void paint(Canvas canvas, Size size) {
    final bottomPadding = 32.0;
    final topPadding = 24.0;
    final leftPadding = 50.0;
    final rightPadding = 16.0;

    final chartWidth = size.width - leftPadding - rightPadding;
    final chartHeight = size.height - bottomPadding - topPadding;

    final gridPaint = Paint()
      ..color = Colors.grey.shade200
      ..strokeWidth = 1.0;

    final textStyle = TextStyle(fontSize: 10, color: Colors.blueGrey.shade400);

    // Y Axis grid lines & labels in thousands (₹k)
    final steps = 4;
    for (int i = 0; i <= steps; i++) {
      final val = ceiling * (i / steps);
      final y = topPadding + chartHeight - (chartHeight * (i / steps));

      canvas.drawLine(Offset(leftPadding, y), Offset(size.width - rightPadding, y), gridPaint);

      final label = val >= 1000 ? '₹${(val / 1000).toStringAsFixed(0)}k' : '₹${val.toStringAsFixed(0)}';
      final textSpan = TextSpan(text: label, style: textStyle);
      final textPainter = TextPainter(text: textSpan, textDirection: TextDirection.ltr);
      textPainter.layout();
      textPainter.paint(canvas, Offset(leftPadding - textPainter.width - 6, y - textPainter.height / 2));
    }

    if (days.length < 2) return;

    final points = <Offset>[];
    final stepX = chartWidth / (days.length - 1);

    for (int i = 0; i < days.length; i++) {
      final x = leftPadding + (i * stepX);
      final normalized = ceiling > 0 ? (days[i].revenue / ceiling).clamp(0.0, 1.0) : 0.0;
      final y = topPadding + chartHeight - (normalized * chartHeight);
      points.add(Offset(x, y));
    }

    // Build smooth curve path
    final path = Path();
    path.moveTo(points[0].dx, points[0].dy);
    for (int i = 0; i < points.length - 1; i++) {
      final p0 = points[i];
      final p1 = points[i + 1];
      final midX = (p0.dx + p1.dx) / 2;
      path.cubicTo(midX, p0.dy, midX, p1.dy, p1.dx, p1.dy);
    }

    // Gradient fill under the curve
    final fillPath = Path.from(path);
    fillPath.lineTo(points.last.dx, topPadding + chartHeight);
    fillPath.lineTo(points.first.dx, topPadding + chartHeight);
    fillPath.close();

    final fillPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          const Color(0xFF14B8A6).withOpacity(0.35),
          const Color(0xFF14B8A6).withOpacity(0.0),
        ],
      ).createShader(Rect.fromLTWH(leftPadding, topPadding, chartWidth, chartHeight));

    canvas.drawPath(fillPath, fillPaint);

    // Glowing stroke
    final strokePaint = Paint()
      ..color = const Color(0xFF0D9488)
      ..strokeWidth = 2.5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    canvas.drawPath(path, strokePaint);

    // Key points (every 5 days)
    final dotPaint = Paint()..color = const Color(0xFF0F766E);
    final dotInner = Paint()..color = Colors.white;

    for (int i = 0; i < points.length; i += 5) {
      canvas.drawCircle(points[i], 4, dotPaint);
      canvas.drawCircle(points[i], 2, dotInner);

      // Date label
      final dateStr = days[i].date;
      final shortDate = dateStr.length >= 10 ? dateStr.substring(5) : dateStr;
      final dSpan = TextSpan(text: shortDate, style: textStyle);
      final dPainter = TextPainter(text: dSpan, textDirection: TextDirection.ltr);
      dPainter.layout();
      dPainter.paint(canvas, Offset(points[i].dx - dPainter.width / 2, topPadding + chartHeight + 8));
    }
  }

  @override
  bool shouldRepaint(covariant _LineChartPainter oldDelegate) => true;
}

// ============================================================================
// OPENSTREETMAP HEATMAP WIDGET (OSM Map with Custom Heatmap Canvas)
// ============================================================================

class OsmHeatmapWidget extends StatefulWidget {
  final List<DriverHeatmapPoint> points;
  final String selectedRegion;

  const OsmHeatmapWidget({
    super.key,
    required this.points,
    required this.selectedRegion,
  });

  @override
  State<OsmHeatmapWidget> createState() => _OsmHeatmapWidgetState();
}

class _OsmHeatmapWidgetState extends State<OsmHeatmapWidget> {
  // Center of India: Lat 21.7679, Lng 78.8718
  double _centerLat = 21.7679;
  double _centerLng = 78.8718;
  int _zoom = 5;

  @override
  void didUpdateWidget(covariant OsmHeatmapWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedRegion != widget.selectedRegion) {
      _focusRegion(widget.selectedRegion);
    }
  }

  void _focusRegion(String region) {
    setState(() {
      switch (region) {
        case 'North':
          _centerLat = 28.6139;
          _centerLng = 77.2090;
          _zoom = 6;
          break;
        case 'West':
          _centerLat = 19.0760;
          _centerLng = 72.8777;
          _zoom = 6;
          break;
        case 'South':
          _centerLat = 12.9716;
          _centerLng = 77.5946;
          _zoom = 6;
          break;
        case 'East':
          _centerLat = 22.5726;
          _centerLng = 88.3639;
          _zoom = 6;
          break;
        case 'Central':
          _centerLat = 23.2599;
          _centerLng = 77.4126;
          _zoom = 6;
          break;
        default:
          _centerLat = 21.7679;
          _centerLng = 78.8718;
          _zoom = 5;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 380,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: const Color(0xFFE2E8F0),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey.shade300),
      ),
      child: Stack(
        children: [
          // OSM Tile background & Heatmap Layer
          Positioned.fill(
            child: CustomPaint(
              painter: _OsmHeatmapCanvasPainter(
                centerLat: _centerLat,
                centerLng: _centerLng,
                zoom: _zoom,
                points: widget.points,
              ),
            ),
          ),
          // Zoom & Reset controls
          Positioned(
            right: 12,
            top: 12,
            child: Column(
              children: [
                _buildMapButton(
                  icon: Icons.add_rounded,
                  onPressed: () {
                    if (_zoom < 10) setState(() => _zoom++);
                  },
                ),
                const SizedBox(height: 6),
                _buildMapButton(
                  icon: Icons.remove_rounded,
                  onPressed: () {
                    if (_zoom > 4) setState(() => _zoom--);
                  },
                ),
                const SizedBox(height: 6),
                _buildMapButton(
                  icon: Icons.my_location_rounded,
                  onPressed: () => _focusRegion('All'),
                ),
              ],
            ),
          ),
          // Region overlay badge
          Positioned(
            left: 12,
            top: 12,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.92),
                borderRadius: BorderRadius.circular(8),
                boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 4)],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.location_on_rounded, color: Colors.roseRed, size: 16),
                  const SizedBox(width: 4),
                  Text(
                    widget.selectedRegion == 'All' ? 'India Logistics Network' : '${widget.selectedRegion} Corridor',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMapButton({required IconData icon, required VoidCallback onPressed}) {
    return Material(
      color: Colors.white.withOpacity(0.92),
      borderRadius: BorderRadius.circular(8),
      elevation: 2,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Icon(icon, size: 20, color: const Color(0xFF1E293B)),
        ),
      ),
    );
  }
}

class _OsmHeatmapCanvasPainter extends CustomPainter {
  final double centerLat;
  final double centerLng;
  final int zoom;
  final List<DriverHeatmapPoint> points;

  _OsmHeatmapCanvasPainter({
    required this.centerLat,
    required this.centerLng,
    required this.zoom,
    required this.points,
  });

  // Convert GPS (lat, lng) to Web Mercator pixel offset relative to center
  Offset _gpsToPixel(double lat, double lng, Size size) {
    final scale = 256.0 * math.pow(2, zoom);

    final xCenter = ((centerLng + 180.0) / 360.0) * scale;
    final sinLatCenter = math.sin(centerLat * math.pi / 180.0).clamp(-0.9999, 0.9999);
    final yCenter = (0.5 - math.log((1 + sinLatCenter) / (1 - sinLatCenter)) / (4 * math.pi)) * scale;

    final xPoint = ((lng + 180.0) / 360.0) * scale;
    final sinLatPoint = math.sin(lat * math.pi / 180.0).clamp(-0.9999, 0.9999);
    final yPoint = (0.5 - math.log((1 + sinLatPoint) / (1 - sinLatPoint)) / (4 * math.pi)) * scale;

    final dx = (size.width / 2) + (xPoint - xCenter);
    final dy = (size.height / 2) + (yPoint - yCenter);

    return Offset(dx, dy);
  }

  @override
  void paint(Canvas canvas, Size size) {
    // 1. Draw stylized OpenStreetMap land & road network grid
    final bgPaint = Paint()..color = const Color(0xFFF1F5F9);
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), bgPaint);

    final gridPaint = Paint()
      ..color = const Color(0xFFCBD5E1).withOpacity(0.6)
      ..strokeWidth = 1.0;

    // Stylized cartographic grid
    for (double x = 0; x < size.width; x += 40) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), gridPaint);
    }
    for (double y = 0; y < size.height; y += 40) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }

    // Major corridor highway lines connecting hubs
    final highwayPaint = Paint()
      ..color = const Color(0xFF94A3B8).withOpacity(0.5)
      ..strokeWidth = 2.0;

    // Golden Quadrilateral representation
    final delhi = _gpsToPixel(28.6139, 77.2090, size);
    final mumbai = _gpsToPixel(19.0760, 72.8777, size);
    final chennai = _gpsToPixel(13.0827, 80.2707, size);
    final kolkata = _gpsToPixel(22.5726, 88.3639, size);
    final bengaluru = _gpsToPixel(12.9716, 77.5946, size);

    canvas.drawLine(delhi, mumbai, highwayPaint);
    canvas.drawLine(mumbai, bengaluru, highwayPaint);
    canvas.drawLine(bengaluru, chennai, highwayPaint);
    canvas.drawLine(chennai, kolkata, highwayPaint);
    canvas.drawLine(kolkata, delhi, highwayPaint);

    // 2. Draw Heatmap Radial Density Blobs
    for (final pt in points) {
      final pos = _gpsToPixel(pt.lat, pt.lng, size);

      // Skip points offscreen
      if (pos.dx < -100 || pos.dx > size.width + 100 || pos.dy < -100 || pos.dy > size.height + 100) {
        continue;
      }

      final radius = math.max(22.0, 36.0 * (zoom / 5.0) * pt.weight);

      // Multi-stop radial gradient for natural thermal heatmap feel
      final heatShader = RadialGradient(
        colors: [
          Colors.red.withOpacity(0.65),
          Colors.amber.withOpacity(0.5),
          Colors.green.withOpacity(0.35),
          Colors.cyan.withOpacity(0.2),
          Colors.blue.withOpacity(0.0),
        ],
        stops: const [0.0, 0.25, 0.55, 0.8, 1.0],
      ).createShader(Rect.fromCircle(center: pos, radius: radius));

      final heatPaint = Paint()
        ..shader = heatShader
        ..blendMode = BlendMode.screen;

      canvas.drawCircle(pos, radius, heatPaint);

      // Driver pin center
      final pinPaint = Paint()..color = const Color(0xFF1E293B);
      canvas.drawCircle(pos, 3.5, pinPaint);
      final pinInner = Paint()..color = Colors.white;
      canvas.drawCircle(pos, 1.5, pinInner);
    }
  }

  @override
  bool shouldRepaint(covariant _OsmHeatmapCanvasPainter oldDelegate) {
    return oldDelegate.centerLat != centerLat ||
        oldDelegate.centerLng != centerLng ||
        oldDelegate.zoom != zoom ||
        oldDelegate.points != points;
  }
}
