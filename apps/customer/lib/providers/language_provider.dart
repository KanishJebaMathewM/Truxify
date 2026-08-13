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
    throw FlutterError(
      'LanguageProvider.of() called with a context that does not contain a '
      'LanguageProviderScope.\n'
      'This usually happens because the context is not a descendant of a '
      'LanguageProviderScope widget. In non-UI contexts (background isolates, '
      'notification handlers, deep links) inject the real provider instance or '
      'read the persisted locale directly instead of relying on a static decoy.',
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
