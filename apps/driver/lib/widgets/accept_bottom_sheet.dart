import 'package:flutter/material.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class AcceptBottomSheet extends StatelessWidget {
  const AcceptBottomSheet({super.key, required this.load});

  final LoadOffer load;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 10, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const BottomSheetHandle(),
          const SizedBox(height: 16),
          Text('Accept this load?', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(load.route, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: TruxifyColors.secondaryText)),
          const SizedBox(height: 16),
          AppCard(
            color: TruxifyColors.accentVeryLight,
            child: Column(
              children: [
                _SheetLine(label: 'Freight value', value: load.freightValue),
                _SheetLine(label: 'Fuel cost', value: '- ${load.fuelCost}', valueColor: TruxifyColors.error),
                _SheetLine(label: 'Toll cost', value: '- ${load.tollCost}', valueColor: TruxifyColors.error),
                const Divider(height: 24),
                _SheetLine(
                  label: 'Net profit',
                  value: load.netProfit,
                  bold: true,
                  valueColor: TruxifyColors.accentDark,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          PrimaryButton(
            label: 'Confirm & Accept',
            onPressed: () => Navigator.of(context).pop(true),
          ),
          const SizedBox(height: 8),
          TextActionButton(
            label: 'Cancel',
            onPressed: () => Navigator.of(context).pop(false),
            color: TruxifyColors.secondaryText,
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sheet line (used in accept bottom sheet)
// ---------------------------------------------------------------------------
class _SheetLine extends StatelessWidget {
  const _SheetLine({required this.label, required this.value, this.valueColor, this.bold = false});

  final String label;
  final String value;
  final Color? valueColor;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: TruxifyColors.secondaryText),
            ),
          ),
          Text(
            value,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: valueColor ?? TruxifyColors.primaryText,
                  fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
                ),
          ),
        ],
      ),
    );
  }
}