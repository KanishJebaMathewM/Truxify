import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class TruxifyController extends ChangeNotifier {
  static const String _themeModeKey = 'driver_theme_mode';
  static const String _availabilityKey = 'driver_is_available';
  static const String _autoAcceptKey = 'auto_accept_orders';

  ThemeMode _themeMode = ThemeMode.system;
  bool _isAvailable = false;
  bool _autoAcceptOrders = false;

  ThemeMode get themeMode => _themeMode;
  bool get isAvailable => _isAvailable;
  bool get autoAcceptOrders => _autoAcceptOrders;

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
}

class TruxifyScope extends InheritedNotifier<TruxifyController> {
  const TruxifyScope({
    super.key,
    required TruxifyController controller,
    required super.child,
  }) : super(notifier: controller);

  static TruxifyController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<TruxifyScope>();
    assert(scope != null, 'TruxifyScope not found in widget tree.');
    return scope!.notifier!;
  }
}
