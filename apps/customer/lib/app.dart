import 'package:flutter/material.dart';

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
        title: 'Truxify',
        theme: TruxifyTheme.light(),
        darkTheme: TruxifyTheme.dark(),
        themeMode: _controller.isDarkMode ? ThemeMode.dark : ThemeMode.light,
        home: const SplashScreen(),
      ),
    );
  }
}
