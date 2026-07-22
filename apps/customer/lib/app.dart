import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'controllers/app_controller.dart';
import 'l10n/app_localizations.dart';
import 'screens/public_tracking_screen.dart';
import 'screens/splash_screen.dart';
import 'theme/app_theme.dart';

class TruxifyApp extends StatefulWidget {
  const TruxifyApp({super.key});

  @override
  State<TruxifyApp> createState() => _TruxifyAppState();
}

class _TruxifyAppState extends State<TruxifyApp> {
  late final TruxifyController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TruxifyController();
    _controller.addListener(_onControllerChanged);
    _controller.loadThemeMode();
  }

  void _onControllerChanged() {
    setState(() {});
  }

  @override
  void dispose() {
    _controller.removeListener(_onControllerChanged);
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
    return TruxifyScope(
      controller: _controller,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        onGenerateTitle: (context) => AppLocalizations.of(context)!.appTitle,
        theme: TruxifyTheme.light(),
        darkTheme: TruxifyTheme.dark(),
        themeMode: _controller.themeMode,
        onGenerateRoute: _onGenerateRoute,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: const [
          Locale('en', ''),
          Locale('hi', ''),
        ],
        home: const SplashScreen(),
      ),
    );
  }
}
