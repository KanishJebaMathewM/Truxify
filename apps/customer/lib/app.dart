import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'controllers/app_controller.dart';
import 'l10n/app_localizations.dart' as app_loc;
import 'providers/language_provider.dart';
import 'screens/public_tracking_screen.dart';
import 'screens/splash_screen.dart';
import 'theme/app_theme.dart';

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

  Route<dynamic>? _onGenerateRoute(RouteSettings settings) {
    final uri = Uri.parse(settings.name ?? '');

    // Public tracking: /track/:token
    if (uri.pathSegments.length == 2 && uri.pathSegments.first == 'track') {
      final token = uri.pathSegments.last;
      if (token.isNotEmpty) {
        return MaterialPageRoute(
          builder: (_) => PublicTrackingScreen(token: token),
          settings: settings,
        );
      }
    }

    return null;
  }

  @override
  Widget build(BuildContext context) {
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
              onGenerateRoute: _onGenerateRoute,
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
              home: const SplashScreen(),
            );
          },
        ),
      ),
    );
  }
}
