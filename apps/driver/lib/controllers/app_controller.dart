import 'dart:developer' as developer;

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class TruxifyController extends ChangeNotifier {
  static const String _themeModeKey = 'driver_theme_mode';
  static const String _availabilityKey = 'driver_is_available';
  static const String _autoAcceptKey = 'auto_accept_orders';
  static const String _languageKey = 'driver_language_code';

  ThemeMode _themeMode = ThemeMode.system;
  bool _isAvailable = false;
  bool _autoAcceptOrders = false;
  Locale _locale = const Locale('en');

  ThemeMode get themeMode => _themeMode;
  bool get isAvailable => _isAvailable;
  bool get autoAcceptOrders => _autoAcceptOrders;
  Locale get locale => _locale;

  Future<void> loadThemeMode() async {
    final prefs = await SharedPreferences.getInstance();
    final savedTheme = prefs.getString(_themeModeKey);

    _themeMode = ThemeMode.values.firstWhere(
      (mode) => mode.name == savedTheme,
      orElse: () => ThemeMode.system,
    );

    _isAvailable = prefs.getBool(_availabilityKey) ?? false;
    _autoAcceptOrders = prefs.getBool(_autoAcceptKey) ?? false;

    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    if (_themeMode == mode) return;

    _themeMode = mode;
    notifyListeners();

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_themeModeKey, mode.name);
  }

  Future<void> setAvailability(bool value) async {
    if (_isAvailable == value) return;
    _isAvailable = value;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_availabilityKey, value);
  }

  Future<void> toggleAutoAccept() async {
    _autoAcceptOrders = !_autoAcceptOrders;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_autoAcceptKey, _autoAcceptOrders);
  }

  // Set once the user picks a language, so a slower startup load of the
  // saved language cannot overwrite that choice.
  bool _localeSelected = false;

  /// Loads the saved language. Returns false if the user picked a language
  /// before the load finished (the saved value is then ignored) or if the
  /// load failed.
  Future<bool> loadLocale() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedCode = prefs.getString(_languageKey) ?? 'en';
      if (_localeSelected) return false;
      _locale = Locale(savedCode);
      notifyListeners();
      return true;
    } catch (e) {
      developer.log('Failed to load language preference, falling back to English: $e');
      return false;
    }
  }

  Future<void> setLocale(String languageCode) async {
    final firstSelection = !_localeSelected;
    _localeSelected = true;
    // Before the first pick the saved value may differ from _locale, so save it.
    if (_locale.languageCode == languageCode && !firstSelection) return;
    _locale = Locale(languageCode);
    notifyListeners();

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_languageKey, languageCode);
    } catch (e) {
      developer.log('Failed to save language preference: $e');
    }
  }
}

class TruxifyScope extends InheritedNotifier<TruxifyController> {
  const TruxifyScope({
    super.key,
    required TruxifyController controller,
    required super.child,
  }) : super(notifier: controller);

  static TruxifyController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<TruxifyScope>();
    if (scope == null) {
      throw FlutterError('TruxifyScope not found in widget tree.');
    }
    final controller = scope.notifier;
    if (controller == null) {
      throw FlutterError('TruxifyScope.notifier is null.');
    }
    return controller;
  }
}
