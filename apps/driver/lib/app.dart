import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'controllers/app_controller.dart';
import 'core/app_routes.dart';
import 'l10n/app_localizations.dart' as app_loc;
import 'providers/language_provider.dart';
import 'screens/documents_screen.dart';
import 'screens/destination_picker_screen.dart';
import 'screens/load_detail_screen.dart';
import 'screens/load_point_detail_screen.dart';
import 'screens/login_screen.dart';
import 'screens/otp_screen.dart';
import 'screens/shell_screen.dart';
import 'screens/splash_screen.dart';
import 'screens/past_trips_screen.dart';
import 'package:provider/provider.dart';
import 'providers/text_scale_provider.dart';
import 'models/app_models.dart';
import 'theme/app_theme.dart';
import 'widgets/app_page_route.dart';

class TruxifyApp extends StatefulWidget {
  const TruxifyApp({super.key, this.languageProvider});
  final LanguageProvider? languageProvider;

  @override
  State<TruxifyApp> createState() => _TruxifyAppState();
}

class _TruxifyAppState extends State<TruxifyApp> {
  late final TruxifyController _controller;
  late final LanguageProvider _languageProvider;

  @override
  void initState() {
    super.initState();

    _controller = TruxifyController();
    _languageProvider = widget.languageProvider ?? LanguageProvider();
    _controller.addListener(_onControllerChanged);
    _languageProvider.addListener(_onControllerChanged);
    _controller.loadThemeMode();
    _controller.loadLocale();
  }

  void _onControllerChanged() {
    setState(() {});
  }

  @override
  void dispose() {
    _controller.removeListener(_onControllerChanged);
    _languageProvider.removeListener(_onControllerChanged);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TruxifyScope(
      controller: _controller,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        builder: (context, child) {
          final isLargeText = context.watch<TextScaleProvider>().isLargeText;
          Widget existingChild = child!;
          return MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: isLargeText
                  ? const TextScaler.linear(1.25)
                  : const TextScaler.linear(1.0),
            ),
            child: existingChild,
          );
        },
        onGenerateTitle: (context) => AppLocalizations.of(context)!.appTitle,
        theme: TruxifyTheme.light(),
        darkTheme: TruxifyTheme.dark(),
        themeMode: _controller.themeMode,
        locale: _controller.locale,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: const [
          Locale('en', ''),
          Locale('hi', ''),
          Locale('ta', ''),
          Locale('kn', ''),
          Locale('mr', ''),
        ],
    return LanguageProviderScope(
      provider: _languageProvider,
      child: TruxifyScope(
        controller: _controller,
        child: ListenableBuilder(
          listenable: _languageProvider,
          builder: (context, _) {
            return MaterialApp(
            debugShowCheckedModeBanner: false,
            onGenerateTitle: (context) => AppLocalizations.of(context)!.appTitle,
            theme: TruxifyTheme.light(),
            darkTheme: TruxifyTheme.dark(),
            themeMode: _controller.themeMode,
            locale: _languageProvider.currentLocale,
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            supportedLocales: const [
              Locale('en'),
              Locale('hi'),
              Locale('ta'),
            ],
        initialRoute: AppRoutes.splash,
        onGenerateRoute: (settings) {
          switch (settings.name) {
            case AppRoutes.splash:
              return truxifyPageRoute(
                (context) => const SplashScreen(),
              );

            case AppRoutes.login:
              return truxifyPageRoute(
                (context) => const LoginScreen(),
              );

            case AppRoutes.otp:
              final args = settings.arguments as Map<String, String>? ?? {};
              return truxifyPageRoute(
                (context) => OtpScreen(
                  phone: args['phone'] ?? '',
                  verificationId: args['verificationId'] ?? '',
                  countryCode: args['countryCode'] ?? '+91',
                ),
              );

            case AppRoutes.shell:
              return truxifyPageRoute(
                (context) => const ShellScreen(),
              );

            case AppRoutes.documents:
              return truxifyPageRoute(
                (context) => const DocumentsScreen(),
              );

            case AppRoutes.loadDetail:
              final load = settings.arguments as LoadOffer?;
              if (load == null) return null;

              return truxifyPageRoute(
                (context) => LoadDetailScreen(load: load),
              );

            case AppRoutes.loadPointDetail:
              final point = settings.arguments as RouteMapPoint?;
              if (point == null) return null;

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

            case AppRoutes.pastTrips:
              return truxifyPageRoute(
                (context) => const PastTripsScreen(),
              );

            default:
              return truxifyPageRoute(
                (context) => const SplashScreen(),
              );
          }
        },
        navigatorObservers: const [],
      );
    },
    ),
    );
  }
}
