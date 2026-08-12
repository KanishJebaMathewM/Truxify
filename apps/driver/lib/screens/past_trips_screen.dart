import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_shared/truxify_shared.dart';

import '../core/config.dart';
import '../l10n/app_localizations.dart';
import '../theme/app_theme.dart';
import '../services/trip_service.dart';

class PastTripsScreen extends StatefulWidget {
  const PastTripsScreen({super.key});

  @override
  State<PastTripsScreen> createState() => _PastTripsScreenState();
}

class _PastTripsScreenState extends State<PastTripsScreen> {
  final TripService _tripService = TripService();
  final ScrollController _scrollController = ScrollController();

  List<Map<String, dynamic>> _trips = [];
  bool _isLoadingTrips = true;
  bool _isLoadingMoreTrips = false;
  String? _tripsError;
  String? _nextTripsCursor;
  bool _hasMoreTrips = true;

  bool _isLoadingReputation = true;
  double? _platformRating;
  int? _onChainScore;
  String _walletAddress = '';
  int _totalTripsCount = 0;
  bool _reputationUnavailable = false;

  final Set<String> _expandedTripIds = {};

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _loadInitialData();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadInitialData() async {
    await Future.wait([
      _loadTrips(),
      _fetchReputation(),
    ]);
  }

  Future<void> _loadTrips() async {
    if (!mounted) return;
    setState(() {
      _isLoadingTrips = true;
      _tripsError = null;
      _nextTripsCursor = null;
      _hasMoreTrips = true;
    });

    try {
      final result = await _tripService.fetchTripHistory(limit: 20, status: 'completed');
      final tripsList = result['trips'] as List<Map<String, dynamic>>;

      if (!mounted) return;
      setState(() {
        _trips = tripsList;
        _nextTripsCursor = result['nextCursor'] as String?;
        _hasMoreTrips = result['hasMore'] as bool? ?? false;
        _isLoadingTrips = false;
      });
    } catch (e) {
      debugPrint('Failed to load completed trips: $e');
      if (!mounted) return;
      setState(() {
        _isLoadingTrips = false;
        _tripsError = e.toString();
      });
    }
  }

  Future<void> _loadMoreTrips() async {
    if (_isLoadingMoreTrips || !_hasMoreTrips || _isLoadingTrips) return;

    setState(() {
      _isLoadingMoreTrips = true;
    });

    try {
      final result = await _tripService.fetchTripHistory(
        cursor: _nextTripsCursor,
        limit: 20,
        status: 'completed',
      );
      final newTrips = result['trips'] as List<Map<String, dynamic>>;

      if (!mounted) return;
      setState(() {
        _trips.addAll(newTrips);
        _nextTripsCursor = result['nextCursor'] as String?;
        _hasMoreTrips = result['hasMore'] as bool? ?? false;
        _isLoadingMoreTrips = false;
      });
    } catch (e) {
      debugPrint('Failed to load more trips: $e');
      if (!mounted) return;
      setState(() {
        _isLoadingMoreTrips = false;
      });
    }
  }

  void _onScroll() {
    if (_scrollController.position.pixels >= _scrollController.position.maxScrollExtent - 200) {
      _loadMoreTrips();
    }
  }

  Future<void> _fetchReputation() async {
    if (!mounted) return;
    setState(() {
      _isLoadingReputation = true;
      _reputationUnavailable = false;
    });

    try {
      final client = Supabase.instance.client;
      final driverId = client.auth.currentUser?.id;
      if (driverId == null) {
        if (mounted) {
          setState(() {
            _isLoadingReputation = false;
          });
        }
        return;
      }

      // Fetch driver wallet and total completed trips from profile/stats
      final statsData = await client
          .from('profiles')
          .select('polygon_wallet_address, driver_details(rating, total_trips)')
          .eq('id', driverId)
          .maybeSingle();

      if (statsData != null) {
        final driverDetails = statsData['driver_details'];
        if (driverDetails is List && driverDetails.isNotEmpty) {
          final first = driverDetails[0];
          _totalTripsCount = (first['total_trips'] as num?)?.toInt() ?? 0;
        } else if (driverDetails is Map<String, dynamic>) {
          _totalTripsCount = (driverDetails['total_trips'] as num?)?.toInt() ?? 0;
        }
      }

      final apiClient = ApiClient(timeout: const Duration(seconds: 10));
      try {
        final data = await apiClient.get('/api/driver/$driverId/reputation');

        if (!mounted) return;

        if (data is Map<String, dynamic>) {
          setState(() {
            _platformRating = (data['supabaseRating'] as num?)?.toDouble() ?? 0.0;
            _onChainScore = data['onChainScore'] != null ? (data['onChainScore'] as num).toInt() : null;
            _walletAddress = data['walletAddress']?.toString() ?? '';
            _isLoadingReputation = false;
          });
        } else {
          setState(() {
            _reputationUnavailable = true;
            _isLoadingReputation = false;
          });
        }
      } finally {
        apiClient.dispose();
      }
    } catch (e) {
      debugPrint('Failed to fetch driver reputation: $e');
      if (mounted) {
        setState(() {
          _reputationUnavailable = true;
          _isLoadingReputation = false;
        });
      }
    }
  }

  void _shareReputation() {
    if (_walletAddress.isEmpty) return;
    final shareUrl = 'https://polygonscan.com/address/$_walletAddress';
    Clipboard.setData(ClipboardData(text: shareUrl)).then((_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('On-chain reputation profile link copied to clipboard!'),
          backgroundColor: TruxifyColors.success,
        ),
      );
    });
  }

  String _formatPaisa(dynamic amount) {
    if (amount == null) return '₹0';
    final val = (Number.tryParse(amount.toString()) ?? 0.0) / 100.0;
    return '₹${val.toStringAsFixed(0)}';
  }

  String _getTier(int score) {
    if (score >= 9500) return 'PLATINUM';
    if (score >= 8500) return 'GOLD';
    if (score >= 7000) return 'SILVER';
    return 'BRONZE';
  }

  Color _getTierColor(String tier) {
    switch (tier) {
      case 'PLATINUM': return Colors.cyan[300]!;
      case 'GOLD': return Colors.amber;
      case 'SILVER': return Colors.grey[400]!;
      case 'BRONZE': return Colors.deepOrange[300]!;
      default: return Colors.white;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: isDark ? TruxifyColors.backgroundDark : Colors.grey[50],
      appBar: AppBar(
        title: Text(
          'Past Trips & Reputation',
          style: GoogleFonts.dmSans(fontWeight: FontWeight.bold, fontSize: 18),
        ),
        elevation: 0,
        backgroundColor: isDark ? TruxifyColors.backgroundDark : Colors.white,
        foregroundColor: isDark ? Colors.white : Colors.black,
      ),
      body: RefreshIndicator(
        onRefresh: _loadInitialData,
        color: TruxifyColors.accent,
        child: CustomScrollView(
          controller: _scrollController,
          slivers: [
            // 1. On-Chain Reputation Header
            SliverPadding(
              padding: const EdgeInsets.all(16.0),
              sliver: SliverToBoxAdapter(
                child: _buildReputationHeader(isDark),
              ),
            ),

            // Section Title
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 18.0, vertical: 8.0),
                child: Text(
                  'COMPLETED TRIP HISTORY',
                  style: GoogleFonts.dmSans(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.2,
                    color: isDark ? Colors.white54 : Colors.grey[600],
                  ),
                ),
              ),
            ),

            // 2. Paginated Completed Trips List
            if (_isLoadingTrips)
              const SliverFillRemaining(
                child: Center(
                  child: CircularProgressIndicator(color: TruxifyColors.accent),
                ),
              )
            else if (_tripsError != null)
              SliverFillRemaining(
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24.0),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.error_outline_rounded, color: TruxifyColors.errorRed, size: 48),
                        const SizedBox(height: 12),
                        Text(
                          'Failed to load trips history',
                          style: GoogleFonts.dmSans(fontSize: 16, fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          _tripsError!,
                          textAlign: TextAlign.center,
                          style: GoogleFonts.dmSans(color: Colors.grey, fontSize: 13),
                        ),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: _loadTrips,
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                ),
              )
            else if (_trips.isEmpty)
              SliverFillRemaining(
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32.0),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: TruxifyColors.accent.withOpacity(0.1),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.history_rounded, size: 48, color: TruxifyColors.accent),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'No completed trips yet',
                          style: GoogleFonts.dmSans(fontSize: 16, fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Complete active load offers to build your decentralized history!',
                          textAlign: TextAlign.center,
                          style: GoogleFonts.dmSans(color: Colors.grey, fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                ),
              )
            else
              SliverList(
                delegate: SliverChildBuilderDelegate(
                  (context, index) {
                    if (index == _trips.length) {
                      return const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24.0),
                        child: Center(
                          child: SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(strokeWidth: 2, color: TruxifyColors.accent),
                          ),
                        ),
                      );
                    }

                    final trip = _trips[index];
                    return _buildTripCard(trip, isDark);
                  },
                  childCount: _trips.length + (_hasMoreTrips ? 1 : 0),
                ),
              ),
            const SliverToBoxAdapter(child: SizedBox(height: 80)),
          ],
        ),
      ),
    );
  }

  Widget _buildReputationHeader(bool isDark) {
    final score = _onChainScore ?? 0;
    final tier = _getTier(score);
    final color = _getTierColor(tier);

    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isDark
              ? [TruxifyColors.accentDark, const Color(0xFF1E293B)]
              : [TruxifyColors.accent, TruxifyColors.accentDark],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: TruxifyColors.accent.withOpacity(isDark ? 0.1 : 0.2),
            blurRadius: 15,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'ON-CHAIN REPUTATION',
                        style: GoogleFonts.dmSans(
                          color: Colors.white70,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.5,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          Text(
                            _isLoadingReputation
                                ? '...'
                                : _onChainScore != null
                                    ? '${(_onChainScore! / 100).toStringAsFixed(1)}'
                                    : '0.0',
                            style: GoogleFonts.dmSans(
                              fontSize: 48,
                              fontWeight: FontWeight.w900,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            '/ 100',
                            style: GoogleFonts.dmSans(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: Colors.white60,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      if (!_isLoadingReputation && _onChainScore != null)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: color.withOpacity(0.2),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: color, width: 1.5),
                          ),
                          child: Text(
                            '$tier TIER',
                            style: GoogleFonts.dmSans(
                              color: color,
                              fontSize: 11,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 1,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                Container(
                  width: 1,
                  height: 100,
                  color: Colors.white24,
                ),
                const SizedBox(width: 24),
                Column(
                  children: [
                    Text(
                      'TOTAL TRIPS',
                      style: GoogleFonts.dmSans(
                        color: Colors.white70,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _isLoadingReputation ? '...' : '$_totalTripsCount',
                      style: GoogleFonts.dmSans(
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'RATING',
                      style: GoogleFonts.dmSans(
                        color: Colors.white70,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.star_rounded, color: Colors.amber, size: 18),
                        const SizedBox(width: 4),
                        Text(
                          _isLoadingReputation
                              ? '...'
                              : _platformRating != null
                                  ? _platformRating!.toStringAsFixed(1)
                                  : '0.0',
                          style: GoogleFonts.dmSans(
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (!_isLoadingReputation && _walletAddress.isNotEmpty)
            InkWell(
              onTap: _shareReputation,
              borderRadius: const BorderRadius.vertical(bottom: Radius.circular(20)),
              child: Container(
                decoration: const BoxDecoration(
                  color: Colors.white10,
                  borderRadius: BorderRadius.vertical(bottom: Radius.circular(20)),
                ),
                padding: const EdgeInsets.symmetric(vertical: 14),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.share_rounded, color: Colors.white, size: 18),
                    const SizedBox(width: 8),
                    Text(
                      'Share On-Chain Reputation',
                      style: GoogleFonts.dmSans(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildTripCard(Map<String, dynamic> trip, bool isDark) {
    final tripId = trip['id']?.toString() ?? '';
    final displayId = trip['trip_display_id']?.toString() ?? '';
    final isExpanded = _expandedTripIds.contains(tripId);

    final totalEarnings = trip['total_earnings'] ?? 0;
    final netEarnings = trip['net_earnings'] ?? 0;
    final routeLabel = trip['route_label']?.toString() ?? 'Unknown Route';
    final tripDateStr = trip['trip_date']?.toString() ?? '';
    final verified = trip['verified_on_chain'] as bool? ?? false;
    final txHash = trip['blockchain_hash']?.toString() ?? '';
    final stars = trip['stars'] as int?;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 6.0),
      decoration: BoxDecoration(
        color: isDark ? TruxifyColors.cardBackgroundDark : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark ? TruxifyColors.darkBorder : Colors.grey[200]!,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header Row
          InkWell(
            onTap: () {
              setState(() {
                if (isExpanded) {
                  _expandedTripIds.remove(tripId);
                } else {
                  _expandedTripIds.add(tripId);
                }
              });
            },
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Text(
                                  displayId,
                                  style: GoogleFonts.robotoMono(
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                    color: isDark ? Colors.cyan[300] : TruxifyColors.accentDark,
                                  ),
                                ),
                                if (verified) ...[
                                  const SizedBox(width: 6),
                                  const Icon(Icons.verified_rounded, color: Colors.green, size: 14),
                                ],
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              routeLabel,
                              style: GoogleFonts.dmSans(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: isDark ? Colors.white : Colors.black87,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              tripDateStr,
                              style: GoogleFonts.dmSans(
                                fontSize: 12,
                                color: Colors.grey,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            _formatPaisa(totalEarnings),
                            style: GoogleFonts.dmSans(
                              fontSize: 18,
                              fontWeight: FontWeight.w900,
                              color: isDark ? Colors.white : Colors.black87,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Net: ${_formatPaisa(netEarnings)}',
                            style: GoogleFonts.dmSans(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: Colors.green,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  if (stars != null) ...[
                    const Divider(height: 20),
                    Row(
                      children: [
                        Text(
                          'Customer Rating: ',
                          style: GoogleFonts.dmSans(fontSize: 12, color: Colors.grey),
                        ),
                        Row(
                          children: List.generate(5, (index) {
                            return Icon(
                              Icons.star_rounded,
                              color: index < stars ? Colors.amber : Colors.grey[300],
                              size: 16,
                            );
                          }),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),

          // Expanded earnings breakdown
          if (isExpanded) ...[
            Container(
              decoration: BoxDecoration(
                color: isDark ? Colors.white.withOpacity(0.02) : Colors.grey[50],
                borderRadius: const BorderRadius.vertical(bottom: Radius.circular(16)),
              ),
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'EARNINGS BREAKDOWN',
                    style: GoogleFonts.dmSans(
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.2,
                      color: isDark ? Colors.white38 : Colors.grey[600],
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildBreakdownRow('Gross Freight', _formatPaisa(trip['base_freight']), isDark),
                  _buildBreakdownRow('Fuel Deduction (Est.)', _formatPaisa(trip['fuel_deducted']), isDark, negative: true),
                  _buildBreakdownRow('Toll Estimate', _formatPaisa(trip['toll_deducted']), isDark, negative: true),
                  _buildBreakdownRow('Platform Fee', _formatPaisa(trip['platform_fee']), isDark, negative: true),
                  const Divider(height: 24),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Net Paid',
                        style: GoogleFonts.dmSans(fontWeight: FontWeight.bold, fontSize: 14),
                      ),
                      Text(
                        _formatPaisa(netEarnings),
                        style: GoogleFonts.dmSans(
                          fontWeight: FontWeight.w900,
                          fontSize: 16,
                          color: Colors.green,
                        ),
                      ),
                    ],
                  ),
                  if (txHash.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: isDark ? Colors.white10 : Colors.grey[200],
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.polyline_rounded, size: 14, color: Colors.grey),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Tx: $txHash',
                              overflow: TextOverflow.ellipsis,
                              style: GoogleFonts.robotoMono(fontSize: 11, color: Colors.grey),
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.copy_rounded, size: 16, color: Colors.grey),
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(),
                            onPressed: () {
                              Clipboard.setData(ClipboardData(text: txHash)).then((_) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('Transaction hash copied to clipboard!'),
                                    backgroundColor: TruxifyColors.success,
                                  ),
                                );
                              });
                            },
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildBreakdownRow(String label, String value, bool isDark, {bool negative = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: GoogleFonts.dmSans(fontSize: 13, color: isDark ? Colors.white60 : Colors.black54),
          ),
          Text(
            negative ? '- $value' : value,
            style: GoogleFonts.dmSans(
              fontSize: 13,
              fontWeight: FontWeight.bold,
              color: negative ? Colors.red : (isDark ? Colors.white87 : Colors.black87),
            ),
          ),
        ],
      ),
    );
  }
}
