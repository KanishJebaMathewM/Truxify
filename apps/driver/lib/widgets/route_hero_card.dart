import 'package:flutter/material.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class RouteHeroCard extends StatelessWidget {
  const RouteHeroCard({super.key,required this.load});

  final LoadOffer load;

  @override
  Widget build(BuildContext context) {
    final parts = load.route.split('→');
    final from = parts.isNotEmpty ? parts.first.trim() : load.route;
    final to = parts.length > 1 ? parts.last.trim() : '';

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // From → To visual
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('FROM', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: TruxifyColors.tertiaryText, letterSpacing: 0.8)),
                    const SizedBox(height: 4),
                    Text(from, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: TruxifyColors.accentVeryLight,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: TruxifyColors.border),
                ),
                child: const Icon(Icons.arrow_forward_rounded, size: 18, color: TruxifyColors.accent),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('TO', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: TruxifyColors.tertiaryText, letterSpacing: 0.8)),
                    const SizedBox(height: 4),
                    Text(to, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800), textAlign: TextAlign.end),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          const Divider(height: 1),
          const SizedBox(height: 14),
          // Quick stats row
          Row(
            children: [
              _QuickStat(icon: Icons.straighten_rounded, label: load.routeDistance),
              const _StatDivider(),
              _QuickStat(icon: Icons.timer_rounded, label: load.routeDuration),
              const _StatDivider(),
              _QuickStat(icon: Icons.account_balance_wallet_rounded, label: load.netProfit, highlight: true),
            ],
          ),
        ],
      ),
    );
  }
}

class _QuickStat extends StatelessWidget {
  const _QuickStat({required this.icon, required this.label, this.highlight = false});

  final IconData icon;
  final String label;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Icon(icon, size: 18, color: highlight ? TruxifyColors.accentDark : TruxifyColors.secondaryText),
          const SizedBox(height: 4),
          Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: highlight ? TruxifyColors.accentDark : TruxifyColors.primaryText,
                ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class _StatDivider extends StatelessWidget {
  const _StatDivider();

  @override
  Widget build(BuildContext context) {
    return Container(width: 1, height: 32, color: TruxifyColors.border);
  }
}