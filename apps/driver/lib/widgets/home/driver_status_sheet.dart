import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../models/earnings_daily_model.dart';
import '../../theme/app_theme.dart';
import '../earnings_shimmer.dart';
import 'metrics_error_card.dart';
import 'shift_metrics_row.dart';

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
  });

  final bool isOnline;
  final bool isLoadingLocation;
  final String currentLocationLabel;
  final bool isLoadingMetrics;
  final String? metricsError;
  final EarningsDailyModel? todayEarnings;
  final double? driverRating;
  final VoidCallback onToggleOnline;

  @override
  Widget build(BuildContext context) {
    final payValue = todayEarnings != null
        ? '₹${todayEarnings!.amount.toStringAsFixed(0)}'
        : '—';
    final hoursValue = todayEarnings != null
        ? '${todayEarnings!.hoursDriven.toStringAsFixed(1)} hrs'
        : '—';
    final ratingValue = driverRating != null
        ? driverRating!.toStringAsFixed(2)
        : '—';

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
          const SizedBox(height: 8),
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
          const SizedBox(height: 16),
          if (isLoadingMetrics)
            const SummaryCardsShimmer()
          else if (metricsError != null)
            const MetricsErrorCard()
          else
            ShiftMetricsRow(
              payValue: payValue,
              hoursValue: hoursValue,
              ratingValue: ratingValue,
            ),
        ],
      ),
    );
  }
}
