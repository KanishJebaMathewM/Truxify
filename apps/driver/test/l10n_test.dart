import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/l10n/app_localizations.dart';

/// Guards the localization layer against the failure that made both apps
/// unbuildable: `supportedLocales` advertised five locales while only two
/// generated delegates were ever committed, so `app_localizations.dart`
/// imported three files that did not exist.
///
/// `isSupported` and the lookup switch must agree exactly — a locale that
/// passes `isSupported` but has no branch in `lookupAppLocalizations` falls
/// through to a `throw FlutterError`, crashing the app at startup for any
/// user whose device is set to that language.
void main() {
  const delegate = AppLocalizations.delegate;

  test('advertises the expected five locales', () {
    expect(
      AppLocalizations.supportedLocales.map((l) => l.languageCode).toSet(),
      {'en', 'hi', 'ta', 'kn', 'mr'},
    );
  });

  test('every advertised locale reports as supported', () {
    for (final locale in AppLocalizations.supportedLocales) {
      expect(
        delegate.isSupported(locale),
        isTrue,
        reason: '${locale.languageCode} is in supportedLocales but isSupported() rejects it',
      );
    }
  });

  test('every advertised locale resolves without throwing', () {
    for (final locale in AppLocalizations.supportedLocales) {
      expect(
        () => lookupAppLocalizations(locale),
        returnsNormally,
        reason: 'lookupAppLocalizations has no branch for ${locale.languageCode}',
      );
    }
  });

  test('every advertised locale returns a non-null translation', () {
    for (final locale in AppLocalizations.supportedLocales) {
      final l10n = lookupAppLocalizations(locale);
      expect(l10n.appTitle, isNotEmpty,
          reason: 'appTitle is empty for ${locale.languageCode}');
    }
  });

  test('an unsupported locale is rejected rather than silently accepted', () {
    expect(delegate.isSupported(const Locale('fr')), isFalse);
    expect(delegate.isSupported(const Locale('de')), isFalse);
  });

  test('isSupported and the lookup switch agree', () {
    // Any locale isSupported() accepts must be resolvable. Divergence between
    // the two is exactly what produces the startup crash.
    for (final code in ['en', 'hi', 'ta', 'kn', 'mr']) {
      final locale = Locale(code);
      expect(delegate.isSupported(locale), isTrue);
      expect(() => lookupAppLocalizations(locale), returnsNormally);
    }
  });

  test('translations differ between locales', () {
    // Catches a delegate accidentally generated from the wrong ARB, which
    // would compile and resolve but serve English everywhere.
    final en = lookupAppLocalizations(const Locale('en')).appTitle;
    final hi = lookupAppLocalizations(const Locale('hi')).appTitle;
    final ta = lookupAppLocalizations(const Locale('ta')).appTitle;

    expect(hi, isNot(equals(en)));
    expect(ta, isNot(equals(en)));
    expect(ta, isNot(equals(hi)));
  });
}
