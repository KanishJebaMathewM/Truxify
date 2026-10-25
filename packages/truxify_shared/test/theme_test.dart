// packages/truxify_shared/test/theme_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:truxify_shared/truxify_shared.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AppTheme Tokens & Configuration', () {
    test('Dark theme tokens match design specification', () {
      expect(AppTheme.darkBackground, const Color(0xFF121212));
      expect(AppTheme.darkSurface, const Color(0xFF1E1E1E));
      expect(AppTheme.primaryAccent, const Color(0xFFFF6B35));
      expect(AppTheme.darkTextPrimary, const Color(0xFFFFFFFF));
      expect(AppTheme.darkTextSecondary, const Color(0xFFB0B0B0));
    });

    test('Tile URLs and brightness helper functions resolve correctly', () {
      expect(
        AppTheme.osmLightTileUrl,
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      );
      expect(
        AppTheme.osmDarkTileUrl,
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      );
      expect(
        AppTheme.getMapTileUrlForBrightness(Brightness.light),
        AppTheme.osmLightTileUrl,
      );
      expect(
        AppTheme.getMapTileUrlForBrightness(Brightness.dark),
        AppTheme.osmDarkTileUrl,
      );
    });

    test('ThemeData configurations have matching brightness and tokens', () {
      final light = AppTheme.lightTheme;
      final dark = AppTheme.darkTheme;

      expect(light.brightness, Brightness.light);
      expect(dark.brightness, Brightness.dark);

      expect(dark.scaffoldBackgroundColor, AppTheme.darkBackground);
      expect(dark.colorScheme.surface, AppTheme.darkSurface);
      expect(dark.colorScheme.primary, AppTheme.primaryAccent);
    });
  });

  group('ThemeProvider State & Persistence', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({});
    });

    test('defaults to ThemeMode.system', () {
      final provider = ThemeProvider(autoLoad: false);
      expect(provider.themeMode, ThemeMode.system);
    });

    test('setThemeMode updates state and persists preference', () async {
      SharedPreferences.setMockInitialValues({});
      final provider = ThemeProvider(autoLoad: false);

      bool notified = false;
      provider.addListener(() {
        notified = true;
      });

      await provider.setThemeMode(ThemeMode.dark);

      expect(provider.themeMode, ThemeMode.dark);
      expect(notified, isTrue);

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('app_theme_mode'), 'dark');
    });

    test('loadThemeMode restores saved preference from SharedPreferences', () async {
      SharedPreferences.setMockInitialValues({'app_theme_mode': 'light'});

      final provider = ThemeProvider(autoLoad: false);
      await provider.loadThemeMode();

      expect(provider.themeMode, ThemeMode.light);
      expect(provider.isInitialized, isTrue);
    });

    test('toggleTheme cycles through ThemeMode states when context is null', () async {
      SharedPreferences.setMockInitialValues({});
      final provider = ThemeProvider(autoLoad: false);

      expect(provider.themeMode, ThemeMode.system);

      await provider.toggleTheme();
      expect(provider.themeMode, ThemeMode.light);

      await provider.toggleTheme();
      expect(provider.themeMode, ThemeMode.dark);

      await provider.toggleTheme();
      expect(provider.themeMode, ThemeMode.system);
    });
  });
}
