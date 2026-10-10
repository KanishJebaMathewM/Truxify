import 'package:flutter/material.dart';

class ResponsiveLayoutBuilder extends StatelessWidget {
  final Widget mobileScaffold;
  final Widget tabletScaffold;
  final Widget desktopScaffold;

  const ResponsiveLayoutBuilder({
    Key? key,
    required this.mobileScaffold,
    required this.tabletScaffold,
    required this.desktopScaffold,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 1024) {
          return desktopScaffold;
        } else if (constraints.maxWidth >= 768) {
          return tabletScaffold;
        } else {
          return mobileScaffold;
        }
      },
    );
  }
}
