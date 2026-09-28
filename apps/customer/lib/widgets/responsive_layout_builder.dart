import 'package:flutter/material.dart';

/// Standard responsive breakpoints used by the customer application.
///
/// Mobile  : < 768px
/// Tablet  : 768px - 1023px
/// Desktop : >= 1024px
enum ResponsiveScreenType {
  mobile,
  tablet,
  desktop,
}

/// Builds different layouts depending on the available screen width.
///
/// This widget is intentionally independent of the application's
/// navigation logic so it can be reused by different screens.
class ResponsiveLayoutBuilder extends StatelessWidget {
  const ResponsiveLayoutBuilder({
    super.key,
    required this.mobile,
    required this.tablet,
    required this.desktop,
  });

  final Widget mobile;
  final Widget tablet;
  final Widget desktop;

  static const double mobileBreakpoint = 768;
  static const double desktopBreakpoint = 1024;

  static ResponsiveScreenType screenTypeForWidth(double width) {
    if (width < mobileBreakpoint) {
      return ResponsiveScreenType.mobile;
    }

    if (width < desktopBreakpoint) {
      return ResponsiveScreenType.tablet;
    }

    return ResponsiveScreenType.desktop;
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final screenType = screenTypeForWidth(constraints.maxWidth);

        switch (screenType) {
          case ResponsiveScreenType.mobile:
            return mobile;

          case ResponsiveScreenType.tablet:
            return tablet;

          case ResponsiveScreenType.desktop:
            return desktop;
        }
      },
    );
  }
}
