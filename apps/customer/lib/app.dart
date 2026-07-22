import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'controllers/app_controller.dart';
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

  @override
  Widget build(BuildContext context) {
    return TruxifyScope(
      controller: _controller,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        onGenerateTitle: (context) => 'Truxify', // Fallback for l10n
        theme: TruxifyTheme.light(),
        darkTheme: TruxifyTheme.dark(),
        themeMode: _controller.themeMode,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: const [
          Locale('en', ''), 
        ],
        home: const SplashScreen(),
      ),
    );
  }
}
