import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class AppLogo extends StatelessWidget {
  const AppLogo({super.key, this.centered = false, this.textStyle, this.iconSize = 22});

  final bool centered;
  final TextStyle? textStyle;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    final logo = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: iconSize + 10,
          height: iconSize + 10,
          decoration: BoxDecoration(
            color: TruxifyColors.accentLight,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(Icons.local_shipping_rounded, color: TruxifyColors.accentDark, size: iconSize),
        ),
        const SizedBox(width: 10),
        Text(
          'FreightFair',
          style: textStyle ?? const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
        ),
      ],
    );

    if (!centered) return logo;
    return Center(child: logo);
  }
}

