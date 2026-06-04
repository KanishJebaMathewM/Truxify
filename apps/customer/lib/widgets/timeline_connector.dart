import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class TimelineConnector extends StatelessWidget {
  const TimelineConnector({
    super.key,
    this.color = TruxifyColors.border,
    this.width = 28,
    this.height = 2,
  });

  final Color color;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(width: width, height: height, color: color);
  }
}
