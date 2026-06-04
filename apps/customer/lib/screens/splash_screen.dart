import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../widgets/app_logo.dart';
import '../widgets/app_page_route.dart';
import 'login_screen.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  Timer? _navigationTimer;

  @override
  void initState() {
    super.initState();
    _navigationTimer = Timer(const Duration(seconds: 2), () {
      if (!mounted) return;
      Navigator.of(context).pushReplacement(AppPageRoute(builder: (_) => const LoginScreen()));
    });
  }

  @override
  void dispose() {
    _navigationTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: TruxifyColors.secondaryBackground,
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [Color(0xFF00897B), Color(0xFF00695C)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const AppLogo(
                centered: true,
                textStyle: TextStyle(
                  color: Colors.white,
                  fontSize: 28,
                  fontWeight: FontWeight.w800,
                ),
                iconSize: 28,
              ),
              const SizedBox(height: 18),
              Text(
                'Freight without middlemen',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      color: Colors.white.withValues(alpha: 0.9),
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
