import 'package:flutter/material.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import '../widgets/route_hero_card.dart';
import '../widgets/accept_bottom_sheet.dart';
import '../widgets/profit_estimate_card.dart';

// ---------------------------------------------------------------------------
// LoadDetailScreen — full details of a load offer for the driver
// ---------------------------------------------------------------------------
class LoadDetailScreen extends StatelessWidget {
  const LoadDetailScreen({super.key, required this.load});

  final LoadOffer load;

  Future<void> _showAcceptSheet(BuildContext context) async {
    final accepted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: TruxifyColors.cardBackground,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => AcceptBottomSheet(load: load),
    );
    if (accepted == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Load accepted successfully'),
          backgroundColor: TruxifyColors.success,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      );
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: TruxifyColors.background,
      appBar: AppBar(
        title: const Text('Load Details'),
        backgroundColor: TruxifyColors.cardBackground,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: _BadgePill(label: '${load.badgeEmoji} ${load.badgeLabel}'),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
          children: [
            // ── Route hero card ──────────────────────────────────────────
            RouteHeroCard(load: load),
            const SizedBox(height: 14),

            // ── Pickup schedule ──────────────────────────────────────────
            _SectionCard(
              icon: Icons.schedule_rounded,
              title: 'Pickup Schedule',
              children: [
                _DetailRow(
                  icon: Icons.location_on_rounded,
                  iconColor: TruxifyColors.accent,
                  label: 'Pickup location',
                  value: load.pickup,
                ),
                _DetailRow(
                  icon: Icons.near_me_rounded,
                  iconColor: TruxifyColors.warning,
                  label: 'Distance from you',
                  value: load.distanceFromDriver,
                ),
                _DetailRow(
                  icon: Icons.straighten_rounded,
                  iconColor: TruxifyColors.secondaryText,
                  label: 'Route distance',
                  value: load.routeDistance,
                ),
                _DetailRow(
                  icon: Icons.timer_rounded,
                  iconColor: TruxifyColors.secondaryText,
                  label: 'Est. duration',
                  value: load.routeDuration,
                ),
                if (load.routeNote.isNotEmpty)
                  _NoteBox(note: load.routeNote),
              ],
            ),
            const SizedBox(height: 14),

            // ── Customer info ────────────────────────────────────────────
            _SectionCard(
              icon: Icons.person_rounded,
              title: 'Customer',
              children: [
                _CustomerHeader(load: load),
                const SizedBox(height: 14),
                _DetailRow(
                  icon: Icons.business_rounded,
                  iconColor: TruxifyColors.secondaryText,
                  label: 'Company',
                  value: load.company,
                ),
                _DetailRow(
                  icon: Icons.star_rounded,
                  iconColor: Colors.amber,
                  label: 'Customer rating',
                  value: '4.9  (28 orders)',
                ),
                _DetailRow(
                  icon: Icons.people_rounded,
                  iconColor: TruxifyColors.secondaryText,
                  label: 'Sharing truck with',
                  value: load.sharingTruckWith,
                ),
              ],
            ),
            const SizedBox(height: 14),

            // ── Goods details ────────────────────────────────────────────
            _SectionCard(
              icon: Icons.inventory_2_rounded,
              title: 'Goods Details',
              children: [
                _GoodsTypeChip(goodsType: load.goods),
                const SizedBox(height: 14),
                _DetailRow(
                  icon: Icons.scale_rounded,
                  iconColor: TruxifyColors.secondaryText,
                  label: 'Weight',
                  value: load.weight,
                ),
                _DetailRow(
                  icon: Icons.crop_free_rounded,
                  iconColor: TruxifyColors.secondaryText,
                  label: 'Dimensions (L×W×H)',
                  value: load.dimensions,
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: _FlagChip(
                        icon: Icons.layers_rounded,
                        label: 'Stackable',
                        value: load.stackable,
                        active: load.stackable.toLowerCase() == 'yes',
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _FlagChip(
                        icon: Icons.warning_rounded,
                        label: 'Fragile',
                        value: load.fragile,
                        active: load.fragile.toLowerCase() == 'yes',
                        activeColor: TruxifyColors.warning,
                        activeBg: TruxifyColors.warningLight,
                      ),
                    ),
                  ],
                ),
                if (load.specialHandling.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  _SpecialHandlingRow(value: load.specialHandling),
                ],
              ],
            ),
            const SizedBox(height: 14),

            // ── Earnings breakdown ───────────────────────────────────────
            _SectionCard(
              icon: Icons.account_balance_wallet_rounded,
              title: 'Earnings Breakdown',
              children: [
                _EarningsRow(label: 'Freight value', value: load.freightValue),
                _EarningsRow(label: 'Fuel cost', value: '- ${load.fuelCost}', isDeduction: true),
                _EarningsRow(label: 'Toll cost', value: '- ${load.tollCost}', isDeduction: true),
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 10),
                  child: Divider(height: 1),
                ),
                _EarningsRow(
                  label: 'Net profit',
                  value: load.netProfit,
                  isTotal: true,
                ),
                if (load.extraDistance > 0) ...[
                  const SizedBox(height: 10),
                  _NoteBox(
                    note: '+${load.extraDistance} km detour · Extra earnings: ${load.extraEarnings}',
                    color: TruxifyColors.warningLight,
                    textColor: TruxifyColors.warning,
                    icon: Icons.alt_route_rounded,
                  ),
                ],
              ],
            ),
            const SizedBox(height: 14),

            // ── AI Profit Estimate ──────────────────────────────────────
            ProfitEstimateCard(load: load),
            const SizedBox(height: 14),

            // ── Truck capacity ───────────────────────────────────────────
            _SectionCard(
              icon: Icons.local_shipping_rounded,
              title: 'Truck Capacity',
              children: [
                _CapacityLegend(load: load),
                const SizedBox(height: 12),
                StackedCapacityBar(
                  thisLoad: load.capacityUsed,
                  otherLoads: 0.0,
                ),
                const SizedBox(height: 10),
                _DetailRow(
                  icon: Icons.check_circle_rounded,
                  iconColor: TruxifyColors.success,
                  label: 'Space available',
                  value: load.spaceAvailable,
                ),
                _DetailRow(
                  icon: Icons.trending_up_rounded,
                  iconColor: TruxifyColors.accent,
                  label: 'Updated total earnings',
                  value: load.updatedTotalEarnings,
                ),
              ],
            ),
          ],
        ),
      ),
      // ── Sticky bottom CTA ──────────────────────────────────────────────
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
          child: PrimaryButton(
            label: 'Accept This Load',
            onPressed: () => _showAcceptSheet(context),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Section card wrapper
// ---------------------------------------------------------------------------
class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.icon, required this.title, required this.children});

  final IconData icon;
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return AppCard(
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
              Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
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
// Detail row with icon
// ---------------------------------------------------------------------------
class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.icon, required this.iconColor, required this.label, required this.value});

  final IconData icon;
  final Color iconColor;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: iconColor),
          const SizedBox(width: 10),
          Expanded(
            child: Text(label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: TruxifyColors.secondaryText)),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              value,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Customer header with avatar
// ---------------------------------------------------------------------------
class _CustomerHeader extends StatelessWidget {
  const _CustomerHeader({required this.load});

  final LoadOffer load;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: const BoxDecoration(
            color: TruxifyColors.accentLight,
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.person_rounded, color: TruxifyColors.accentDark, size: 24),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(load.customer, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 2),
              Text(load.company, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: TruxifyColors.secondaryText)),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: TruxifyColors.successLight,
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            'Verified',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: TruxifyColors.success,
                  fontWeight: FontWeight.w700,
                ),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Goods type chip
// ---------------------------------------------------------------------------
class _GoodsTypeChip extends StatelessWidget {
  const _GoodsTypeChip({required this.goodsType});

  final String goodsType;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: TruxifyColors.accentVeryLight,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: TruxifyColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.category_rounded, size: 16, color: TruxifyColors.accentDark),
          const SizedBox(width: 8),
          Text(
            goodsType,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: TruxifyColors.accentDark,
                ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Flag chip (Stackable / Fragile)
// ---------------------------------------------------------------------------
class _FlagChip extends StatelessWidget {
  const _FlagChip({
    required this.icon,
    required this.label,
    required this.value,
    required this.active,
    this.activeColor = TruxifyColors.accentDark,
    this.activeBg = TruxifyColors.accentLight,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool active;
  final Color activeColor;
  final Color activeBg;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: active ? activeBg : TruxifyColors.background,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: active ? activeColor.withValues(alpha: 0.3) : TruxifyColors.border),
      ),
      child: Row(
        children: [
          Icon(icon, size: 16, color: active ? activeColor : TruxifyColors.tertiaryText),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: TruxifyColors.tertiaryText)),
                Text(
                  value,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: active ? activeColor : TruxifyColors.secondaryText,
                      ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Special handling row
// ---------------------------------------------------------------------------
class _SpecialHandlingRow extends StatelessWidget {
  const _SpecialHandlingRow({required this.value});

  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: TruxifyColors.warningLight,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: TruxifyColors.warning.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.info_rounded, size: 16, color: TruxifyColors.warning),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Special: $value',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: TruxifyColors.warning,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Earnings row
// ---------------------------------------------------------------------------
class _EarningsRow extends StatelessWidget {
  const _EarningsRow({required this.label, required this.value, this.isDeduction = false, this.isTotal = false});

  final String label;
  final String value;
  final bool isDeduction;
  final bool isTotal;

  @override
  Widget build(BuildContext context) {
    Color valueColor = TruxifyColors.primaryText;
    if (isDeduction) valueColor = TruxifyColors.error;
    if (isTotal) valueColor = TruxifyColors.accentDark;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontWeight: isTotal ? FontWeight.w800 : FontWeight.w500,
                    color: isTotal ? TruxifyColors.primaryText : TruxifyColors.secondaryText,
                  ),
            ),
          ),
          Text(
            value,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  fontWeight: isTotal ? FontWeight.w800 : FontWeight.w600,
                  color: valueColor,
                  fontSize: isTotal ? 16 : null,
                ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Capacity legend
// ---------------------------------------------------------------------------
class _CapacityLegend extends StatelessWidget {
  const _CapacityLegend({required this.load});

  final LoadOffer load;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _LegendDot(color: TruxifyColors.accent, label: 'This load (${(load.capacityUsed * 100).round()}%)'),
        const SizedBox(width: 16),
        _LegendDot(color: TruxifyColors.border, label: 'Available'),
      ],
    );
  }
}

class _LegendDot extends StatelessWidget {
  const _LegendDot({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 6),
        Text(label, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: TruxifyColors.secondaryText)),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Note box
// ---------------------------------------------------------------------------
class _NoteBox extends StatelessWidget {
  const _NoteBox({
    required this.note,
    this.color = TruxifyColors.accentVeryLight,
    this.textColor = TruxifyColors.accentDark,
    this.icon = Icons.info_outline_rounded,
  });

  final String note;
  final Color color;
  final Color textColor;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: textColor),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              note,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: textColor, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Badge pill (appbar)
// ---------------------------------------------------------------------------
class _BadgePill extends StatelessWidget {
  const _BadgePill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: TruxifyColors.accentLight,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: TruxifyColors.accentDark,
              fontWeight: FontWeight.w700,
            ),
      ),
    );
  }
}
