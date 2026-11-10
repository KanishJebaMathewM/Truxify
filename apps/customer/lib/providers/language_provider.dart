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
    // The app wraps its root in LanguageProviderScope (app.dart) — a missing
    // scope is a wiring bug, so fail loudly instead of silently diverging
    // state across a shared default instance.
    throw FlutterError(
      'LanguageProvider.of() called with a context that does not contain a '
      'LanguageProviderScope.',
    );
  }
}

class LanguageProviderScope extends InheritedNotifier<LanguageProvider> {
  const LanguageProviderScope({
    super.key,
    required LanguageProvider provider,
    required super.child,
  }) : super(notifier: provider);
}
