import 'package:flutter/material.dart';

import 'core/app_routes.dart';
import 'screens/documents_screen.dart';
import 'screens/destination_picker_screen.dart';
import 'screens/load_detail_screen.dart';
import 'screens/load_point_detail_screen.dart';
import 'screens/login_screen.dart';
import 'screens/otp_screen.dart';
import 'screens/shell_screen.dart';
import 'screens/splash_screen.dart';
import 'models/app_models.dart';
import 'theme/app_theme.dart';
import 'widgets/app_page_route.dart';

class TruxifyApp extends StatelessWidget {
  const TruxifyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Truxify Driver',
      theme: TruxifyTheme.light(),
      initialRoute: AppRoutes.splash,
      onGenerateRoute: (settings) {
        switch (settings.name) {
          case AppRoutes.splash:
            return truxifyPageRoute((context) => const SplashScreen());
          case AppRoutes.login:
            return truxifyPageRoute((context) => const LoginScreen());
          case AppRoutes.otp:
            final phone = settings.arguments as String? ?? '';
            return truxifyPageRoute((context) => OtpScreen(phone: phone));
          case AppRoutes.shell:
            return truxifyPageRoute((context) => const ShellScreen());
          case AppRoutes.documents:
            return truxifyPageRoute((context) => const DocumentsScreen());
          case AppRoutes.loadDetail:
            final load = settings.arguments as LoadOffer;
            return truxifyPageRoute(
              (context) => LoadDetailScreen(load: load),
            );
          case AppRoutes.loadPointDetail:
            final point = settings.arguments as RouteMapPoint;
            return truxifyPageRoute(
              (context) => LoadPointDetailScreen(point: point),
            );
          case AppRoutes.destinationPicker:
            final args = settings.arguments as DestinationPickerArgs?;
            return truxifyPageRoute(
              (context) => DestinationPickerScreen(
                title: args?.title ?? 'Select Destination',
                initialQuery: args?.initialQuery,
                initialPoint: args?.initialPoint,
              ),
            );
          
          default:
            return truxifyPageRoute((context) => const SplashScreen());
        }
      },
      navigatorObservers: const [],
    );
  }
}
