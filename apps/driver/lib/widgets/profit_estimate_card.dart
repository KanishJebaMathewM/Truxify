import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';

import '../models/app_models.dart';
import '../services/marketplace_repository.dart';
import '../theme/app_theme.dart';

class ProfitEstimateCard extends StatefulWidget {
  const ProfitEstimateCard({
    super.key,
    required this.load,
    this.truckMileageKmL = 6.0,
    this.fuelPricePerLitre = 102.0,
    this.tripDurationHours,
  });

  final LoadOffer load;
  final double truckMileageKmL;
  final double fuelPricePerLitre;
  final double? tripDurationHours;

  @override
  State<ProfitEstimateCard> createState() => _ProfitEstimateCardState();
}

class _ProfitEstimateCardState extends State<ProfitEstimateCard> {
  bool _isLoading = true;
  ProfitPrediction? _prediction;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchPrediction();
  }

  Future<void> _fetchPrediction() async {
    final duration = widget.tripDurationHours ?? _parseDurationHours(widget.load.routeDuration);
    if (duration <= 0) {
      if (mounted) setState(() { _isLoading = false; _error = 'Insufficient data'; });
      return;
    }

    try {
      final repo = MarketplaceRepository();
      final prediction = await repo.predictLoadProfit(
        load: widget.load,
        truckMileageKmL: widget.truckMileageKmL,
        fuelPricePerLitre: widget.fuelPricePerLitre,
        tripDurationHours: duration,
      );
      repo.dispose();
      if (mounted) setState(() { _prediction = prediction; _isLoading = false; });
    } catch (_) {
      if (mounted) setState(() { _isLoading = false; _error = 'Prediction unavailable'; });
    }
  }

  double _parseDurationHours(String raw) {
    final hourMatch = RegExp(r'(\d+)\s*h').firstMatch(raw);
    final minMatch = RegExp(r'(\d+)\s*m').firstMatch(raw);
    final hours = double.tryParse(hourMatch?.group(1) ?? '') ?? 0;
    final mins = double.tryParse(minMatch?.group(1) ?? '') ?? 0;
    return hours + mins / 60;
  }

  @override
  Widget build(BuildContext context) {
    return _SectionCard(
      icon: Icons.psychology_rounded,
      title: 'AI Profit Estimate',
      trailing: _AiTooltip(),
      children: [
        if (_isLoading) ...[
          const _ProfitShimmer(),
        ] else if (_prediction != null) ...[
          _ProfitContent(prediction: _prediction!),
        ] else ...[
          _ProfitFallback(error: _error),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Section card wrapper (matches load_detail_screen.dart pattern)
// ---------------------------------------------------------------------------
class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.icon,
    required this.title,
    required this.children,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final List<Widget> children;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: Theme.of(context).brightness == Brightness.dark
              ? TruxifyColors.darkBorder
              : TruxifyColors.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: TruxifyColors.accentVeryLight,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, size: 16, color: TruxifyColors.accentDark),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
              if (trailing != null) trailing!,
            ],
          ),
          const SizedBox(height: 14),
          const Divider(height: 1),
          const SizedBox(height: 14),
          ...children,
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// AI-generated tooltip
// ---------------------------------------------------------------------------
class _AiTooltip extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: 'This estimate is AI-generated based on route, cargo, and truck data. Actual profit may vary.',
      triggerMode: TooltipTriggerMode.tap,
      preferBelow: false,
      decoration: BoxDecoration(
        color: TruxifyColors.accentDark,
        borderRadius: BorderRadius.circular(10),
      ),
      textStyle: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w500),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: TruxifyColors.accentVeryLight,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.auto_awesome_rounded, size: 12, color: TruxifyColors.accentDark),
            const SizedBox(width: 4),
            Text(
              'AI',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w800,
                color: TruxifyColors.accentDark,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Profit content — shown when prediction succeeds
// ---------------------------------------------------------------------------
class _ProfitContent extends StatelessWidget {
  const _ProfitContent({required this.prediction});

  final ProfitPrediction prediction;

  @override
  Widget build(BuildContext context) {
    final isHigh = prediction.predictedProfit > 5000;
    final isLow = prediction.predictedProfit < 1000;
    final Color profitColor = isHigh
        ? TruxifyColors.success
        : isLow
            ? TruxifyColors.error
            : TruxifyColors.warning;
    final Color profitBg = isHigh
        ? TruxifyColors.successLight
        : isLow
            ? TruxifyColors.errorLight
            : TruxifyColors.warningLight;
    final String label = isHigh ? 'High' : isLow ? 'Low' : 'Moderate';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              prediction.formattedProfit,
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: profitColor,
                  ),
            ),
            const SizedBox(width: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: profitBg,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                '$label profitability',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: profitColor,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Icon(Icons.show_chart_rounded, size: 14, color: TruxifyColors.secondaryText),
            const SizedBox(width: 6),
            Text(
              'Range: ${prediction.formattedRange}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: TruxifyColors.secondaryText,
                    fontWeight: FontWeight.w500,
                  ),
            ),
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Fallback — shown when prediction fails
// ---------------------------------------------------------------------------
class _ProfitFallback extends StatelessWidget {
  const _ProfitFallback({required this.error});

  final String? error;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: TruxifyColors.accentVeryLight,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          const Icon(Icons.info_outline_rounded, size: 15, color: TruxifyColors.tertiaryText),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              error ?? 'Profit estimate unavailable',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: TruxifyColors.tertiaryText,
                    fontWeight: FontWeight.w500,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Shimmer loading skeleton
// ---------------------------------------------------------------------------
class _ProfitShimmer extends StatelessWidget {
  const _ProfitShimmer();

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final baseColor = isDark ? TruxifyColors.darkBorder : TruxifyColors.border;
    final highlightColor = isDark ? TruxifyColors.darkSecondaryBackground : TruxifyColors.subtleBorder;

    return Shimmer.fromColors(
      baseColor: baseColor,
      highlightColor: highlightColor,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 100,
                height: 28,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(6),
                ),
              ),
              const SizedBox(width: 10),
              Container(
                width: 80,
                height: 18,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            width: 180,
            height: 14,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(4),
            ),
          ),
        ],
      ),
    );
  }
}
