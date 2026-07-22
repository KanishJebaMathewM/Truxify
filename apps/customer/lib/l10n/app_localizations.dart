import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_hi.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you'll need to edit this
/// file.
///
/// First, open your project's ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project's Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('hi'),
  ];

  String get appTitle;

  String get loginTitle;

  String get bookLoadButton;

  String get loadingText;

  String comingSoon(String title);

  String greetingMessage(String greeting, String displayName);

  String get noActiveShipments;

  String get routeHistoryComingSoon;

  String get walletAddressUpdated;

  String get polygonWalletAddress;

  String get saveWalletAddress;

  String error(String errorMsg);

  String get lightTheme;

  String get darkTheme;

  String get retry;

  String get cancel;

  String get save;

  String get close;

  String get apply;

  String get reset;

  String get search;

  String get welcomeBack;

  String get signInSubtitle;

  String get phoneNumber;

  String get sendOtp;

  String get sendingOtp;

  String get verifyingOtp;

  String get verifyOtp;

  String get loginWithBiometrics;

  String get biometricsNotSupported;

  String get biometricAuthSuccessful;

  String get pleaseEnterPhone;

  String get phoneDigitsOnly;

  String phoneMustBeExactDigits(int digitCount);

  String get phoneMustBeDigits;

  String get verificationFailed;

  String get phoneVerificationFailed;

  String get autoVerificationFailed;

  String get failedToSendOtp;

  String get enterOtp;

  String sentTo(String phoneNumber);

  String get invalidOtp;

  String get verificationSessionExpired;

  String get invalidVerificationCode;

  String get otpExpired;

  String get home;

  String get findTrucks;

  String get orders;

  String get profile;

  String get activeShipments;

  String get seeAll;

  String get bookATruck;

  String get active;

  String get moreStats;

  String get savings;

  String get yourUsualRoutes;

  String get lastTruckLocation;

  String get couldNotLoadData;

  String get mlPoweredMatching;

  String get route;

  String get pickupLocation;

  String get dropLocation;

  String get date;

  String get time;

  String get goodsDetails;

  String get goodsType;

  String get weightTonnes;

  String get lengthFt;

  String get widthFt;

  String get heightFt;

  String get stackable;

  String get fragile;

  String get specialRequirements;

  String get estimatedPriceRange;

  String get stableThisWeek;

  String get estimatingPrice;

  String get estimateUnavailable;

  String get enterRouteDetails;

  String get basedOnCurrentDemand;

  String get filterTrucks;

  String get truckType;

  String get capacityTonnes;

  String get materialType;

  String get today;

  String get tomorrow;

  String get selectPickupOnMap;

  String get selectDropOnMap;

  String get temperatureControl;

  String get waterproofCover;

  String get loadingHelp;

  String get loadingHelpNeeded;

  String get other;

  String get describeYourGoods;

  String get activeTab;

  String get historyTab;

  String get searchOrdersHint;

  String get noActiveOrders;

  String get noHistoryOrders;

  String get offlineMode;

  String lastUpdated(String timeAgo);

  String get driverAssigned;

  String get inTransit;

  String get paymentReleased;

  String get delivered;

  String get cancelled;

  String get pending;

  String get account;

  String get preferences;

  String get paymentMethods;

  String get myDocuments;

  String get savedAddresses;

  String get walletAddressLabel;

  String get notSet;

  String get language;

  String get helpSupport;

  String get aboutTruxify;

  String get logout;

  String offlineModeLabel(String timeAgo);

  String get ordersLabel;

  String get savedLabel;

  String get co2Label;

  String get editProfile;

  String get fullName;

  String get companyName;

  String get phone;

  String get enterFullName;

  String get enterCompanyName;

  String get enterPhoneNumber;

  String get nameIsRequired;

  String get companyNameIsRequired;

  String get phoneNumberIsRequired;

  String get saving;

  String get saveChanges;

  String get profileUpdatedSuccessfully;

  String get failedToLoadProfile;

  String get failedToUpdateProfile;

  String get orderNotFound;

  String get notification;

  String get unableToOpen;
  String get downloadInvoice;

  String get generatingInvoice;

  String get invoiceReady;

  String get shareInvoice;

  String get printInvoice;

  String get downloadFailed;

  String get noRoutesFound;

  String get bookAgain;

  String get viewAllOrders;

  String get recentRoutes;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'hi'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'hi':
      return AppLocalizationsHi();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
