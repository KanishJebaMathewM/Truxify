import 'package:flutter/material.dart';

class AppLogo extends StatelessWidget {
  const AppLogo({
    super.key,
    this.centered = false,
    this.textStyle,
    this.iconSize = 22,
  });

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
            color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(
            Icons.local_shipping_rounded,
            color: Theme.of(context).colorScheme.primary,
            size: iconSize,
          ),
        ),
        const SizedBox(width: 10),
        Text(
          'Truxify',
          style: textStyle ??
              const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
              ),
        ),
      ],
    );

    if (!centered) return logo;
    return Center(child: logo);
  }
}