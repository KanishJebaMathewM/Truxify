import 'package:flutter/material.dart';

class LanguageProvider extends ChangeNotifier {
  Locale _currentLocale = const Locale('en');

  Locale get currentLocale => _currentLocale;

  void changeLocale(String languageCode) {
    _currentLocale = Locale(languageCode);
    notifyListeners();
  }

  static LanguageProvider of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<LanguageProviderScope>();
    if (scope != null && scope.notifier != null) {
      return scope.notifier!;
    }
    return _defaultInstance;
  }

  static final LanguageProvider _defaultInstance = LanguageProvider();
}

class LanguageProviderScope extends InheritedNotifier<LanguageProvider> {
  const LanguageProviderScope({
    super.key,
    required LanguageProvider provider,
    required super.child,
  }) : super(notifier: provider);
}
