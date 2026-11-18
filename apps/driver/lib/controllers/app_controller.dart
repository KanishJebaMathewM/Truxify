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

  // Last language code known to be stored, so a pick whose save failed can
  // be saved again when the user applies it a second time.
  String? _savedLanguageCode;

  /// Loads the saved language. Returns false if no language is saved, if the
  /// user picked a language before the load finished (the saved value is then
  /// ignored) or if the load failed.
  Future<bool> loadLocale() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedCode = prefs.getString(_languageKey);
      if (savedCode == null || _localeSelected) return false;
      _savedLanguageCode = savedCode;
      _locale = Locale(savedCode);
      notifyListeners();
      return true;
    } catch (e) {
      developer.log('Failed to load language preference, falling back to English: $e');
      return false;
    }
  }

  Future<void> setLocale(String languageCode) async {
    _localeSelected = true;
    if (_locale.languageCode != languageCode) {
      _locale = Locale(languageCode);
      notifyListeners();
    }
    // Skip the save only when this language is already stored.
    if (_savedLanguageCode == languageCode) return;

    try {
      final prefs = await SharedPreferences.getInstance();
      if (await prefs.setString(_languageKey, languageCode)) {
        _savedLanguageCode = languageCode;
      }
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
