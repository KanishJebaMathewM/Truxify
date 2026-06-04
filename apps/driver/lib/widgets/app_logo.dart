import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class TruxifyLogo extends StatelessWidget {
  const TruxifyLogo({super.key, this.size = 28, this.textColor});

  final double size;
  final Color? textColor;

  @override
  Widget build(BuildContext context) {
    final color = textColor ?? Theme.of(context).colorScheme.onSurface;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: size * 1.15,
          height: size * 1.15,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [TruxifyColors.accent, TruxifyColors.accentDark],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(size * 0.28),
            boxShadow: [
              BoxShadow(
                  color: TruxifyColors.accent.withValues(alpha: 0.06),
                  blurRadius: 8,
                  offset: const Offset(0, 2))
            ],
          ),
          child: Center(
            child: Icon(
              Icons.local_shipping_rounded,
              size: size * 0.62,
              color: TruxifyColors.white,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Text(
          'Truxify',
          style: TextStyle(
            color: color,
            fontSize: size - 2,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.4,
          ),
        ),
      ],
    );
  }
}
