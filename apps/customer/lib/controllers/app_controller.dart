import 'dart:developer' as developer;

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:truxify_shared/truxify_shared.dart';
import '../models/app_models.dart';
import '../core/offline/cache/cache_manager.dart';

class TruxifyController extends ChangeNotifier {
  final ThemeProvider themeProvider;
  int currentTab = 0;
  int ordersTabIndex = 0;
  RouteDraft? pendingRouteDraft;
  String? _globalError;
  bool _isInitialized = false;
  Locale _locale = const Locale('en');

  TruxifyController({ThemeProvider? themeProvider})
      : themeProvider = themeProvider ?? ThemeProvider() {
    this.themeProvider.addListener(_onThemeProviderChanged);
  }

  void _onThemeProviderChanged() {
    notifyListeners();
  }

  ThemeMode get themeMode => themeProvider.themeMode;
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
    await themeProvider.loadThemeMode();
    _isInitialized = true;
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    await themeProvider.setThemeMode(mode);
  }

  @override
  void dispose() {
    themeProvider.removeListener(_onThemeProviderChanged);
    super.dispose();
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
    } catch (e) {
      developer.log('Failed to load language preference, falling back to English: $e');
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
    } catch (e) {
      developer.log('Failed to save language preference: $e');
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
