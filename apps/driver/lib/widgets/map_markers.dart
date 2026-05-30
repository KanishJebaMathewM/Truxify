import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../theme/app_theme.dart';

class RouteMarker extends StatelessWidget {
  const RouteMarker({
    super.key,
    required this.icon,
    required this.fillColor,
    required this.shadowColor,
  });

  final IconData icon;
  final Color fillColor;
  final Color shadowColor;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Container(
      decoration: BoxDecoration(
        color: colorScheme.surface,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: shadowColor.withValues(alpha: 0.3),
            blurRadius: 8,
            spreadRadius: 2,
          ),
        ],
      ),
      padding: const EdgeInsets.all(4),
      child: Container(
        decoration: BoxDecoration(
          color: fillColor,
          shape: BoxShape.circle,
        ),
        padding: const EdgeInsets.all(6),
        child: Icon(
          icon,
          color: colorScheme.onPrimary,
          size: 16,
        ),
      ),
    );
  }
}

class RouteCheckpointMarker extends StatelessWidget {
  const RouteCheckpointMarker({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Container(
      decoration: BoxDecoration(
        color: colorScheme.surface,
        shape: BoxShape.circle,
        border: Border.all(color: TruxifyColors.accent, width: 2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.1),
            blurRadius: 4,
          ),
        ],
      ),
      width: 24,
      height: 24,
      alignment: Alignment.center,
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.clip,
          style: GoogleFonts.dmSans(
            fontSize: 10,
            fontWeight: FontWeight.bold,
            color: TruxifyColors.accentDark,
          ),
        ),
      ),
    );
  }
}