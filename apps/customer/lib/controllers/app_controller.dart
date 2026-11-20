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
      final cacheManager = CacheManager();
      await cacheManager.open();
      final settings = await cacheManager.getSettings();
      final savedCode = settings['language']?['code']?.toString();
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
      final cacheManager = CacheManager();
      await cacheManager.open();
      await cacheManager.cacheSettings({
        'language': {
          'code': languageCode,
          'name': _nameForLanguageCode(languageCode),
        },
      });
      _savedLanguageCode = languageCode;
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
      case 'es': return 'Spanish';
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
