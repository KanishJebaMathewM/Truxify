import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../theme/app_theme.dart';

class MetricsErrorCard extends StatelessWidget {
  const MetricsErrorCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark
            ? Theme.of(context).colorScheme.surfaceContainerHighest
            : TruxifyColors.background,
        border: Border.all(color: TruxifyColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline_rounded,
              size: 14, color: TruxifyColors.errorRed),
          const SizedBox(width: 6),
          Text(
            'Metrics unavailable',
            style: GoogleFonts.dmSans(
              fontSize: 11,
              color: TruxifyColors.errorRed,
            ),
          ),
        ],
      ),
    );
  }
}
