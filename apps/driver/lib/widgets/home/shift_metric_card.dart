import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../theme/app_theme.dart';

class ShiftMetricCard extends StatelessWidget {
  const ShiftMetricCard({
    super.key,
    required this.icon,
    required this.value,
    required this.label,
    this.labelKey,
  });

  final IconData icon;
  final String value;
  final String label;
  final Key? labelKey;

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
            style: GoogleFonts.dmSans(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
          Text(
            label,
            key: labelKey,
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
