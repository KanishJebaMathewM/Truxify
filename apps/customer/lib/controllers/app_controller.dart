import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/app_models.dart';
import '../core/offline/cache/cache_manager.dart';

class TruxifyController extends ChangeNotifier {
  static const String _themeModeKey = 'theme_mode';
  int currentTab = 0;
  int ordersTabIndex = 0;
  RouteDraft? pendingRouteDraft;
  ThemeMode _themeMode = ThemeMode.system;
  String? _globalError;
  bool _isInitialized = false;
  Locale _locale = const Locale('en');

  ThemeMode get themeMode => _themeMode;
  String? get globalError => _globalError;
  bool get isInitialized => _isInitialized;
  Locale get locale => _locale;

  void setGlobalError(String? error) {
    _globalError = error;
    notifyListeners();
  }

  void clearGlobalError() {
    _globalError = null;
    notifyListeners();
  }

  bool _validateTabIndex(int index) {
    return index >= 0 && index <= 3;
  }

  Future<void> loadThemeMode() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedTheme = prefs.getString(_themeModeKey);
      _themeMode = ThemeMode.values.firstWhere(
        (mode) => mode.name == savedTheme,
        orElse: () => ThemeMode.system,
      );
      _isInitialized = true;
      notifyListeners();
    } catch (e) {
      _globalError = 'Failed to load theme: $e';
      _isInitialized = true;
      notifyListeners();
    }
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    if (_themeMode == mode) return;
    _themeMode = mode;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_themeModeKey, mode.name);
    } catch (e) {
      _globalError = 'Failed to save theme: $e';
      notifyListeners();
    }
  }

  void setTab(int index) {
    if (!_validateTabIndex(index)) return;
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

  Future<void> loadLocale() async {
    try {
      final cacheManager = CacheManager();
      await cacheManager.open();
      final settings = await cacheManager.getSettings();
      final selectedCode = settings['language']?['code']?.toString() ?? 'en';
      _locale = Locale(selectedCode);
      notifyListeners();
    } catch (_) {
      // Ignore cache manager loading errors, fallback to English
    }
  }

  Future<void> setLocale(String languageCode) async {
    if (_locale.languageCode == languageCode) return;
    _locale = Locale(languageCode);
    notifyListeners();

    try {
      final cacheManager = CacheManager();
      await cacheManager.open();
      await cacheManager.cacheSettings({
        'language': {
          'code': languageCode,
          'name': _nameForLanguageCode(languageCode),
        },
      });
    } catch (_) {
      // Ignore cache manager errors
    }
  }

  String _nameForLanguageCode(String code) {
    switch (code) {
      case 'en': return 'English';
      case 'hi': return 'Hindi';
      case 'ta': return 'Tamil';
      case 'kn': return 'Kannada';
      case 'mr': return 'Marathi';
      default: return 'English';
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
    assert(scope != null, 'TruxifyScope not found in widget tree.');
    return scope!.notifier!;
  }
}
