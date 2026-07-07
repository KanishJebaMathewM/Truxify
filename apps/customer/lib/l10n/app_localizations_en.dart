// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Truxify';

  @override
  String get loginTitle => 'Welcome to Truxify';

  @override
  String get bookLoadButton => 'Book a Load';

  @override
  String get loadingText => 'Loading...';
}
