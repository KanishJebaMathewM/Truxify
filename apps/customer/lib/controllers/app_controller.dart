import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/app_models.dart';

class TruxifyController extends ChangeNotifier {
  static const String _themeModeKey = 'theme_mode';
  int currentTab = 0;
  int ordersTabIndex = 0;
  RouteDraft? pendingRouteDraft;
  ThemeMode _themeMode = ThemeMode.system;

  ThemeMode get themeMode => _themeMode;

  Future<void> loadThemeMode() async {
    final prefs = await SharedPreferences.getInstance();
    final savedTheme = prefs.getString(_themeModeKey);

    _themeMode = ThemeMode.values.firstWhere(
      (mode) => mode.name == savedTheme,
      orElse: () => ThemeMode.system,
    );

    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    if (_themeMode == mode) return;

    _themeMode = mode;
    notifyListeners();

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_themeModeKey, mode.name);
  }

  void setTab(int index) {
    if (currentTab == index) return;
    currentTab = index;
    notifyListeners();
  }

  void openFindTrucks({RouteDraft? draft}) {
    pendingRouteDraft = draft;
    currentTab = 1;
    notifyListeners();
  }

  RouteDraft? consumePendingRouteDraft() {
    final draft = pendingRouteDraft;
    pendingRouteDraft = null;
    return draft;
  }

  void openOrders({int tabIndex = 0}) {
    ordersTabIndex = tabIndex;
    currentTab = 2;
    notifyListeners();
  }

  void setOrdersTab(int index) {
    if (ordersTabIndex == index) return;
    ordersTabIndex = index;
    notifyListeners();
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
