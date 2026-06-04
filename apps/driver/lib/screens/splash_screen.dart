import 'dart:async';

import 'package:flutter/material.dart';

import '../core/app_routes.dart';
import '../data/mock_data.dart';
import '../theme/app_theme.dart';
import '../widgets/app_logo.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    Timer(const Duration(seconds: 2), () {
      if (!mounted) {
        return;
      }
      Navigator.of(context).pushReplacementNamed(AppRoutes.login);
    });
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 92,
              height: 92,
              decoration: BoxDecoration(
                color: colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(28),
              ),
              child: const Icon(Icons.local_shipping_rounded,
                  color: TruxifyColors.accent, size: 44),
            ),
            const SizedBox(height: 20),
            const TruxifyLogo(size: 34, textColor: TruxifyColors.accent),
            const SizedBox(height: 14),
            Text(
              onboardingTagline,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: TruxifyColors.adaptiveSecondaryText(context),
                    fontWeight: FontWeight.w500,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}
