import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../models/earnings_daily_model.dart';
import '../../theme/app_theme.dart';
import '../earnings_shimmer.dart';
import 'metrics_error_card.dart';

/// Bottom sheet shown on the Home screen when no active trip is selected.
/// Displays the driver online/offline toggle and today's earnings summary
/// (gross, net after fuel/toll estimate, and trip count).
class DriverStatusSheet extends StatelessWidget {
  const DriverStatusSheet({
    super.key,
    required this.isOnline,
    required this.isLoadingLocation,
    required this.currentLocationLabel,
    required this.isLoadingMetrics,
    required this.metricsError,
    required this.todayEarnings,
    required this.driverRating,
    required this.onToggleOnline,
    this.batteryLevel,
    this.isCharging = false,
    this.hasActiveTrip = false,
    this.onFindLoad,
    this.onViewTrip,
  });

  final bool isOnline;
  final bool isLoadingLocation;
  final String currentLocationLabel;
  final bool isLoadingMetrics;
  final String? metricsError;
  final EarningsDailyModel? todayEarnings;
  final double? driverRating;
  final VoidCallback onToggleOnline;
  final int? batteryLevel;
  final bool isCharging;

  /// Whether the driver currently has an active trip.
  /// Controls visibility of the "View Active Trip" CTA.
  final bool hasActiveTrip;

  /// Called when the driver taps "Find New Load".
  final VoidCallback? onFindLoad;

  /// Called when the driver taps "View Active Trip".
  final VoidCallback? onViewTrip;

  @override
  Widget build(BuildContext context) {
    final gross = todayEarnings != null
        ? '₹${todayEarnings!.amount.toStringAsFixed(0)}'
        : '—';
    final net = todayEarnings != null
        ? '₹${todayEarnings!.netAmount.toStringAsFixed(0)}'
        : '—';
    final tripCountValue = todayEarnings != null
        ? '${todayEarnings!.tripCount}'
        : null;
    // Net estimate: gross × 0.85 (accounts for ~15% fuel/toll costs).
    final netValue = todayEarnings != null && todayEarnings!.amount > 0
        ? 'Net ≈ ₹${(todayEarnings!.amount * 0.85).toStringAsFixed(0)}'
        : null;

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        border: Border.all(color: TruxifyColors.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Online / Offline toggle ──────────────────────────────────────
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: isOnline
                          ? TruxifyColors.success
                          : TruxifyColors.secondaryText,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: (isOnline
                                  ? TruxifyColors.success
                                  : TruxifyColors.secondaryText)
                              .withValues(alpha: 0.4),
                          blurRadius: 6,
                          spreadRadius: 2,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    isOnline ? 'Online & Ready' : 'Offline',
                    style: GoogleFonts.dmSans(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                ],
              ),
              Switch(
                value: isOnline,
                onChanged: (_) => onToggleOnline(),
                activeThumbColor: TruxifyColors.success,
              ),
            ],
          ),

          const SizedBox(height: 4),

          // Subtitle / radar text
          Text(
            !isOnline
                ? 'Offline. Go online to receive load assignments.'
                : isLoadingLocation
                    ? 'Radar active. Fetching your location...'
                    : 'Radar active. Looking for load assignments near $currentLocationLabel...',
            style: GoogleFonts.dmSans(
              fontSize: 11,
              color: TruxifyColors.adaptiveSecondaryText(context),
            ),
          ),

          // Battery indicator
          if (batteryLevel != null) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                Icon(
                  _batteryIcon(batteryLevel!, isCharging),
                  size: 14,
                  color: _batteryColor(batteryLevel!),
                ),
                const SizedBox(width: 6),
                Text(
                  '$batteryLevel%${isCharging ? ' · Charging' : ''}',
                  style: GoogleFonts.dmSans(
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                    color: _batteryColor(batteryLevel!),
                  ),
                ),
              ],
            ),
          ],

          const SizedBox(height: 16),

          // ── Today's Earnings card ────────────────────────────────────────
          if (isLoadingMetrics)
            const SummaryCardsShimmer()
          else if (metricsError != null)
            MetricsErrorCard(errorMessage: metricsError)
          else
            ShiftMetricsRow(
              payValue: payValue,
              hoursValue: hoursValue,
              ratingValue: ratingValue,
              tripCountValue: tripCountValue,
              netValue: netValue,
            ),
          // ── Quick CTA Buttons ─────────────────────────────────────────────
          if (isOnline && (onFindLoad != null || (hasActiveTrip && onViewTrip != null))) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                if (onFindLoad != null)
                  Expanded(
                    child: OutlinedButton.icon(
                      key: const Key('find_new_load_button'),
                      onPressed: onFindLoad,
                      icon: const Icon(Icons.search_rounded, size: 16),
                      label: const Text('Find New Load'),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        textStyle: GoogleFonts.dmSans(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),
                  ),
                if (hasActiveTrip && onViewTrip != null) ...[
                  if (onFindLoad != null) const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton.icon(
                      key: const Key('view_active_trip_button'),
                      onPressed: onViewTrip,
                      icon: const Icon(Icons.route_rounded, size: 16),
                      label: const Text('Active Trip'),
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        textStyle: GoogleFonts.dmSans(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }

  IconData _batteryIcon(int level, bool charging) {
    if (charging) return Icons.battery_charging_full_rounded;
    if (level > 80) return Icons.battery_full_rounded;
    if (level > 50) return Icons.battery_5_bar_rounded;
    if (level > 20) return Icons.battery_3_bar_rounded;
    if (level > 10) return Icons.battery_2_bar_rounded;
    return Icons.battery_1_bar_rounded;
  }

  Color _batteryColor(int level) {
    if (level <= 10) return TruxifyColors.errorRed;
    if (level <= 20) return TruxifyColors.warning;
    return TruxifyColors.success;
  }
}

// ── Private metric card widget ────────────────────────────────────────────────

class _EarningsMetricCard extends StatelessWidget {
  const _EarningsMetricCard({
    required this.icon,
    required this.value,
    required this.label,
    this.valueKey,
  });

  final IconData icon;
  final String value;
  final String label;
  final Key? valueKey;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark
            ? Theme.of(context).colorScheme.surfaceContainerHighest
            : TruxifyColors.background,
        border: Border.all(color: TruxifyColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Icon(icon, size: 16, color: TruxifyColors.accent),
          const SizedBox(height: 6),
          Text(
            value,
            key: valueKey,
            style: GoogleFonts.dmSans(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
          Text(
            label,
            style: GoogleFonts.dmSans(
              fontSize: 9,
              color: TruxifyColors.adaptiveSecondaryText(context),
            ),
          ),
        ],
      ),
    );
  }
}