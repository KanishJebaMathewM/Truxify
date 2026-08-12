import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../l10n/app_localizations.dart';
import '../../models/deadhead_recommendation.dart';
import '../../models/marketplace_models.dart';
import '../../theme/app_theme.dart';
import '../common_widgets.dart';

class DeadheadRecommendationCard extends StatelessWidget {
  const DeadheadRecommendationCard({
    super.key,
    required this.recommendation,
    required this.bid,
    required this.isSubmitting,
    required this.onOpenLoad,
    required this.onBid,
  });

  final DeadheadRecommendation recommendation;
  final DriverBid? bid;
  final bool isSubmitting;
  final VoidCallback onOpenLoad;
  final Future<void> Function(num amount) onBid;

  Color _scoreColor(BuildContext context) {
    final score = recommendation.matchScore;
    if (score >= 80) return TruxifyColors.success;
    if (score >= 60) return TruxifyColors.accent;
    if (score >= 40) return TruxifyColors.warning;
    return TruxifyColors.error;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final scoreColor = _scoreColor(context);

    return AppCard(
      margin: const EdgeInsets.only(bottom: 12),
      onTap: onOpenLoad,
      elevation: 2,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: scoreColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      recommendation.matchScore.toStringAsFixed(0),
                      style: GoogleFonts.dmSans(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: scoreColor,
                        height: 1,
                      ),
                    ),
                    Text(
                      '%',
                      style: GoogleFonts.dmSans(
                        fontSize: 9,
                        color: scoreColor,
                        height: 1,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            recommendation.route.isNotEmpty
                                ? recommendation.route
                                : l10n.recommendedForYou,
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(fontWeight: FontWeight.w800),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 6),
                        StatusPill(
                          label: recommendation.matchScoreLabel,
                          backgroundColor: scoreColor.withValues(alpha: 0.12),
                          foregroundColor: scoreColor,
                        ),
                      ],
                    ),
                    if (recommendation.goodsType.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        recommendation.goodsType,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 6,
            children: [
              _DetailChip(
                icon: Icons.account_balance_wallet_rounded,
                label: '₹${recommendation.estimatedEarnings.toStringAsFixed(0)}',
              ),
              _DetailChip(
                icon: Icons.alt_route_rounded,
                label: '${recommendation.detourKm.toStringAsFixed(1)} km detour',
              ),
              _DetailChip(
                icon: Icons.near_me_rounded,
                label:
                    '${recommendation.distanceToPickupKm.toStringAsFixed(1)} km to pickup',
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Text(
                  '${l10n.matchScore}: ${recommendation.matchScore.toStringAsFixed(0)}%',
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
              TextButton(
                onPressed: isSubmitting
                    ? null
                    : () async {
                        final result = await showModalBottomSheet<num>(
                          context: context,
                          isScrollControlled: true,
                          backgroundColor: TruxifyColors.cardBackground,
                          shape: const RoundedRectangleBorder(
                            borderRadius: BorderRadius.vertical(
                                top: Radius.circular(24)),
                          ),
                          builder: (_) => _RecommendationBidSheet(
                            recommendation: recommendation,
                            existingBid: bid,
                          ),
                        );
                        if (result != null) await onBid(result);
                      },
                style: TextButton.styleFrom(
                    foregroundColor: TruxifyColors.accent),
                child: Text(isSubmitting
                    ? l10n.loadingText
                    : (bid == null ? l10n.bidOnLoad : l10n.updateBid)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _DetailChip extends StatelessWidget {
  const _DetailChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: TruxifyColors.secondaryBackground,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: TruxifyColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: TruxifyColors.secondaryText),
          const SizedBox(width: 6),
          Text(
            label,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: TruxifyColors.primaryText),
          ),
        ],
      ),
    );
  }
}

class _RecommendationBidSheet extends StatefulWidget {
  const _RecommendationBidSheet({
    required this.recommendation,
    required this.existingBid,
  });

  final DeadheadRecommendation recommendation;
  final DriverBid? existingBid;

  @override
  State<_RecommendationBidSheet> createState() =>
      _RecommendationBidSheetState();
}

class _RecommendationBidSheetState extends State<_RecommendationBidSheet> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.existingBid?.amount.toString(),
  );
  String? _error;
  bool _submitting = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final raw = _controller.text.trim();
    final amount = num.tryParse(raw);
    if (amount == null || amount <= 0) {
      setState(() => _error = AppLocalizations.of(context)!.enterValidBid);
      return;
    }
    setState(() {
      _error = null;
      _submitting = true;
    });
    Navigator.of(context).pop(amount);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const BottomSheetHandle(),
          const SizedBox(height: 16),
          Text(
            l10n.placeYourBid,
            style: GoogleFonts.dmSans(
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            widget.recommendation.route.isNotEmpty
                ? widget.recommendation.route
                : widget.recommendation.loadId,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _controller,
            keyboardType: TextInputType.number,
            autofocus: true,
            decoration: InputDecoration(
              labelText: l10n.bidAmount,
              prefixText: '₹ ',
              errorText: _error,
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton(
              onPressed: _submitting ? null : _submit,
              style: ElevatedButton.styleFrom(
                backgroundColor: TruxifyColors.accent,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: _submitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Text(
                      l10n.submitBid,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
