// apps/shared/lib/providers/theme_provider.dart
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../theme/app_theme.dart';

/// Provider for managing and persisting the application ThemeMode (Light, Dark, System).
class ThemeProvider extends ChangeNotifier {
  static const String _prefKey = 'app_theme_mode';

  ThemeMode _themeMode = ThemeMode.system;
  bool _isInitialized = false;
  bool _userSelected = false;

  ThemeProvider({bool autoLoad = true}) {
    if (autoLoad) {
      loadThemeMode();
    }
  }

  /// Current active ThemeMode.
  ThemeMode get themeMode => _themeMode;

  /// Whether the provider has loaded persisted settings from SharedPreferences.
  bool get isInitialized => _isInitialized;

  /// Determines if dark mode is currently effective given a BuildContext.
  bool isDarkMode(BuildContext context) {
    if (_themeMode == ThemeMode.dark) return true;
    if (_themeMode == ThemeMode.light) return false;
    return MediaQuery.platformBrightnessOf(context) == Brightness.dark;
  }

  /// Returns the appropriate map tile URL (OSM or Dark Matter) for the current state.
  String mapTileUrl(BuildContext context) {
    return isDarkMode(context) ? AppTheme.osmDarkTileUrl : AppTheme.osmLightTileUrl;
  }

  /// Sets the theme mode, notifies listeners, and persists to SharedPreferences.
  Future<void> setThemeMode(ThemeMode mode) async {
    if (_themeMode == mode && (_isInitialized || _userSelected)) return;

    _userSelected = true;
    _themeMode = mode;
    notifyListeners();

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefKey, _modeToString(mode));
    } catch (e) {
      debugPrint('[ThemeProvider] Error saving theme mode: $e');
    }
  }

  /// Cycles through ThemeMode: system -> light -> dark -> system (or toggles light/dark).
  Future<void> toggleTheme([BuildContext? context]) async {
    if (context != null) {
      // Toggle to the opposite of current resolved brightness
      final currentlyDark = isDarkMode(context);
      await setThemeMode(currentlyDark ? ThemeMode.light : ThemeMode.dark);
    } else {
      // Rotate through modes
      switch (_themeMode) {
        case ThemeMode.system:
          await setThemeMode(ThemeMode.light);
          break;
        case ThemeMode.light:
          await setThemeMode(ThemeMode.dark);
          break;
        case ThemeMode.dark:
          await setThemeMode(ThemeMode.system);
          break;
      }
    }
  }

  /// Loads the persisted ThemeMode from SharedPreferences.
  Future<void> loadThemeMode() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedModeStr = prefs.getString(_prefKey);
      if (_userSelected) {
        // Keep the mode the user selected while loading.
      } else if (savedModeStr != null) {
        _themeMode = _modeFromString(savedModeStr);
      } else {
        _themeMode = ThemeMode.system;
      }
    } catch (e) {
      debugPrint('[ThemeProvider] Error loading theme mode: $e');
      if (!_userSelected) {
        _themeMode = ThemeMode.system;
      }
    } finally {
      _isInitialized = true;
      notifyListeners();
    }
  }

  String _modeToString(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.light:
        return 'light';
      case ThemeMode.dark:
        return 'dark';
      case ThemeMode.system:
        return 'system';
    }
  }

  ThemeMode _modeFromString(String value) {
    switch (value.toLowerCase()) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      case 'system':
      default:
        return ThemeMode.system;
    }
  }
}
