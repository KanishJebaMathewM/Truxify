import 'package:flutter/material.dart';

import '../models/app_models.dart';
import '../theme/app_theme.dart';

/// Displays the estimated net profit breakdown for a load offer.
///
/// All values are clearly marked as estimates with an "~ Estimated" disclaimer
/// so drivers are never misled. A collapsed summary row is shown by default;
/// tapping it expands the full cost line-items.
class NetProfitBreakdownCard extends StatefulWidget {
  const NetProfitBreakdownCard({
    super.key,
    required this.breakdown,
    this.initiallyExpanded = false,
  });

  final NetProfitBreakdown breakdown;

  /// If `true` the breakdown starts fully expanded (used on the Load Details
  /// screen where space is not at a premium).
  final bool initiallyExpanded;

  @override
  State<NetProfitBreakdownCard> createState() => _NetProfitBreakdownCardState();
}

class _NetProfitBreakdownCardState extends State<NetProfitBreakdownCard> {
  late bool _expanded;

  @override
  void initState() {
    super.initState();
    _expanded = widget.initiallyExpanded;
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.breakdown;
    final isProfit = b.estimatedNetProfit >= 0;
    final profitColor =
        isProfit ? TruxifyColors.success : TruxifyColors.error;

    return Container(
      decoration: BoxDecoration(
        color: isProfit
            ? TruxifyColors.success.withValues(alpha: 0.06)
            : TruxifyColors.error.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isProfit
              ? TruxifyColors.success.withValues(alpha: 0.25)
              : TruxifyColors.error.withValues(alpha: 0.25),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Header row (always visible) ─────────────────────────────────
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
              child: Row(
                children: [
                  Icon(
                    isProfit
                        ? Icons.trending_up_rounded
                        : Icons.trending_down_rounded,
                    color: profitColor,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '~ Est. net profit',
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(
                                color: TruxifyColors.adaptiveSecondaryText(
                                    context),
                              ),
                        ),
                        Text(
                          '₹${_fmt(b.estimatedNetProfit)}',
                          style: Theme.of(context)
                              .textTheme
                              .titleMedium
                              ?.copyWith(
                                fontWeight: FontWeight.w800,
                                color: profitColor,
                              ),
                        ),
                      ],
                    ),
                  ),
                  if (b.distanceKm > 0) ...[
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          '~ ₹${_fmt(b.profitPerKm)}/km',
                          style: Theme.of(context)
                              .textTheme
                              .bodyMedium
                              ?.copyWith(
                                fontWeight: FontWeight.w700,
                                color: profitColor,
                              ),
                        ),
                        Text(
                          '${_fmt(b.distanceKm)} km trip',
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: TruxifyColors.adaptiveSecondaryText(
                                        context),
                                  ),
                        ),
                      ],
                    ),
                    const SizedBox(width: 4),
                  ],
                  Icon(
                    _expanded
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    size: 20,
                    color: TruxifyColors.adaptiveSecondaryText(context),
                  ),
                ],
              ),
            ),
          ),

          // ── Expanded line-items ──────────────────────────────────────────
          if (_expanded) ...[
            Divider(
              height: 1,
              color: isProfit
                  ? TruxifyColors.success.withValues(alpha: 0.20)
                  : TruxifyColors.error.withValues(alpha: 0.20),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
              child: Column(
                children: [
                  _ProfitLine(
                    label: 'Freight',
                    amount: b.freightAmount,
                    isPositive: true,
                    context: context,
                  ),
                  _ProfitLine(
                    label: '~ Est. fuel cost',
                    amount: b.estimatedFuelCost,
                    isDeduction: true,
                    context: context,
                  ),
                  _ProfitLine(
                    label: '~ Est. toll cost',
                    amount: b.estimatedTollCost,
                    isDeduction: true,
                    context: context,
                  ),
                  _ProfitLine(
                    label: '~ Other costs',
                    amount: b.otherCosts,
                    isDeduction: true,
                    context: context,
                  ),
                  const SizedBox(height: 6),
                  const Divider(height: 1),
                  const SizedBox(height: 6),
                  _ProfitLine(
                    label: '~ Est. net profit',
                    amount: b.estimatedNetProfit,
                    isTotal: true,
                    context: context,
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const Icon(Icons.info_outline_rounded,
                          size: 13, color: Colors.grey),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          'Values are estimates based on default fuel price, '
                          'mileage, toll rates, and trip distance. Actual costs '
                          'may vary.',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: Colors.grey,
                                fontSize: 11,
                              ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ProfitLine extends StatelessWidget {
  const _ProfitLine({
    required this.label,
    required this.amount,
    required this.context,
    this.isDeduction = false,
    this.isPositive = false,
    this.isTotal = false,
  });

  final String label;
  final double amount;
  final BuildContext context;
  final bool isDeduction;
  final bool isPositive;
  final bool isTotal;

  @override
  Widget build(BuildContext buildContext) {
    Color? valueColor;
    String prefix = '';

    if (isTotal) {
      valueColor = amount >= 0 ? TruxifyColors.success : TruxifyColors.error;
    } else if (isDeduction) {
      prefix = '− ';
      valueColor = TruxifyColors.adaptiveSecondaryText(context);
    } else if (isPositive) {
      valueColor = TruxifyColors.adaptiveSecondaryText(context);
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Row(
        children: [
          Text(
            label,
            style: Theme.of(buildContext).textTheme.bodyMedium?.copyWith(
                  fontWeight:
                      isTotal ? FontWeight.w800 : FontWeight.w500,
                  color: isTotal
                      ? null
                      : TruxifyColors.adaptiveSecondaryText(context),
                ),
          ),
          const Spacer(),
          Text(
            '$prefix₹${_fmt(amount.abs())}',
            style: Theme.of(buildContext).textTheme.bodyMedium?.copyWith(
                  fontWeight: isTotal ? FontWeight.w800 : FontWeight.w600,
                  color: valueColor,
                ),
          ),
        ],
      ),
    );
  }
}

/// Format a double as an INR string with up to 2 decimal places,
/// dropping trailing zeros (e.g. 9000.0 → "9,000", 22.5 → "22.50").
String _fmt(double value) {
  if (value == value.truncateToDouble()) {
    return value.abs().toStringAsFixed(0).replaceAllMapped(
          RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'),
          (m) => '${m[1]},',
        );
  }
  return value.abs().toStringAsFixed(2);
}
