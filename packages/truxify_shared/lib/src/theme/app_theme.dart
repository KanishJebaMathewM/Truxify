// packages/truxify_shared/lib/src/theme/app_theme.dart
import 'package:flutter/material.dart';

/// Central theme definitions for all Truxify Flutter apps.
class AppTheme {
  // ─── Dark Theme Tokens (Spec) ──────────────────────────────────────────────
  /// Background: Material dark surface (#121212)
  static const Color darkBackground = Color(0xFF121212);

  /// Surface: Elevated dark surface (#1E1E1E)
  static const Color darkSurface = Color(0xFF1E1E1E);

  /// Primary accent: Truxify Orange (#FF6B35) — high contrast on dark
  static const Color primaryAccent = Color(0xFFFF6B35);

  /// Text Primary: Pure white (#FFFFFF)
  static const Color darkTextPrimary = Color(0xFFFFFFFF);

  /// Text Secondary: Light muted grey (#B0B0B0)
  static const Color darkTextSecondary = Color(0xFFB0B0B0);

  /// Dark borders and dividers
  static const Color darkBorder = Color(0xFF2C2C2C);
  static const Color darkCard = Color(0xFF1E1E1E);

  // ─── Light Theme Tokens ────────────────────────────────────────────────────
  static const Color lightBackground = Color(0xFFF7F8FA);
  static const Color lightSurface = Color(0xFFFFFFFF);
  static const Color lightTextPrimary = Color(0xFF1A1A1A);
  static const Color lightTextSecondary = Color(0xFF6B7280);
  static const Color lightBorder = Color(0xFFE5E7EB);
  static const Color lightCard = Color(0xFFFFFFFF);

  // ─── Status / Support Colors ───────────────────────────────────────────────
  static const Color success = Color(0xFF10B981);
  static const Color warning = Color(0xFFF59E0B);
  static const Color error = Color(0xFFEF4444);
  static const Color info = Color(0xFF3B82F6);

  // ─── Map Tile URLs (OSM & Dark Matter) ──────────────────────────────────────
  /// Standard OpenStreetMap tiles for light mode
  static const String osmLightTileUrl =
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  /// CartoDB Dark Matter tiles for dark mode
  static const String osmDarkTileUrl =
      'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';

  /// Returns the appropriate map tile URL based on current context brightness.
  static String getMapTileUrl(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return isDark ? osmDarkTileUrl : osmLightTileUrl;
  }

  /// Returns the appropriate map tile URL based on explicit brightness.
  static String getMapTileUrlForBrightness(Brightness brightness) {
    return brightness == Brightness.dark ? osmDarkTileUrl : osmLightTileUrl;
  }

  // ─── Light ThemeData ───────────────────────────────────────────────────────
  static ThemeData get lightTheme {
    final colorScheme = ColorScheme.light(
      primary: primaryAccent,
      secondary: primaryAccent,
      surface: lightSurface,
      surfaceContainerHighest: Color(0xFFF3F4F6),
      error: error,
      onPrimary: Colors.white,
      onSecondary: Colors.white,
      onSurface: lightTextPrimary,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: lightBackground,
      canvasColor: lightSurface,
      cardColor: lightCard,
      dividerColor: lightBorder,
      appBarTheme: const AppBarTheme(
        elevation: 0,
        centerTitle: false,
        backgroundColor: lightSurface,
        foregroundColor: lightTextPrimary,
        surfaceTintColor: Colors.transparent,
      ),
      cardTheme: CardThemeData(
        color: lightCard,
        elevation: 1,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: lightBorder, width: 1),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primaryAccent,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: primaryAccent,
          side: const BorderSide(color: primaryAccent, width: 1.5),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: lightSurface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: lightBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: lightBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: primaryAccent, width: 1.5),
        ),
      ),
      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: lightSurface,
        selectedIconTheme: IconThemeData(color: primaryAccent),
        unselectedIconTheme: IconThemeData(color: lightTextSecondary),
        selectedLabelTextStyle: TextStyle(
          color: primaryAccent,
          fontWeight: FontWeight.w600,
        ),
        unselectedLabelTextStyle: TextStyle(color: lightTextSecondary),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: lightSurface,
        selectedItemColor: primaryAccent,
        unselectedItemColor: lightTextSecondary,
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          selectedBackgroundColor: WidgetStateProperty.all(primaryAccent),
          selectedForegroundColor: WidgetStateProperty.all(Colors.white),
          foregroundColor: WidgetStateProperty.all(lightTextPrimary),
          backgroundColor: WidgetStateProperty.all(lightSurface),
          side: WidgetStateProperty.all(
            const BorderSide(color: lightBorder, width: 1),
          ),
        ),
      ),
    );
  }

  // ─── Dark ThemeData ────────────────────────────────────────────────────────
  static ThemeData get darkTheme {
    final colorScheme = ColorScheme.dark(
      primary: primaryAccent,
      secondary: primaryAccent,
      surface: darkSurface,
      surfaceContainerHighest: Color(0xFF282828),
      error: error,
      onPrimary: Colors.white,
      onSecondary: Colors.white,
      onSurface: darkTextPrimary,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: darkBackground,
      canvasColor: darkSurface,
      cardColor: darkCard,
      dividerColor: darkBorder,
      appBarTheme: const AppBarTheme(
        elevation: 0,
        centerTitle: false,
        backgroundColor: darkSurface,
        foregroundColor: darkTextPrimary,
        surfaceTintColor: Colors.transparent,
      ),
      cardTheme: CardThemeData(
        color: darkCard,
        elevation: 1,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: darkBorder, width: 1),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primaryAccent,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: primaryAccent,
          side: const BorderSide(color: primaryAccent, width: 1.5),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: darkSurface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: darkBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: darkBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: primaryAccent, width: 1.5),
        ),
        hintStyle: const TextStyle(color: darkTextSecondary),
        labelStyle: const TextStyle(color: darkTextSecondary),
      ),
      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: darkSurface,
        selectedIconTheme: IconThemeData(color: primaryAccent),
        unselectedIconTheme: IconThemeData(color: darkTextSecondary),
        selectedLabelTextStyle: TextStyle(
          color: primaryAccent,
          fontWeight: FontWeight.w600,
        ),
        unselectedLabelTextStyle: TextStyle(color: darkTextSecondary),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: darkSurface,
        selectedItemColor: primaryAccent,
        unselectedItemColor: darkTextSecondary,
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          selectedBackgroundColor: WidgetStateProperty.all(primaryAccent),
          selectedForegroundColor: WidgetStateProperty.all(Colors.white),
          foregroundColor: WidgetStateProperty.all(darkTextPrimary),
          backgroundColor: WidgetStateProperty.all(darkSurface),
          side: WidgetStateProperty.all(
            const BorderSide(color: darkBorder, width: 1),
          ),
        ),
      ),
    );
  }
}
