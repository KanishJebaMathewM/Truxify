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

  String get loadingText;

  String get retry;

  String get error;

  String get cancel;

  String get save;

  String get close;

  String get apply;

  String get reset;

  String get search;

  String get welcomeDriver;

  String get logInToStartEarning;

  String get phoneNumber;

  String get sendOtp;

  String get sending;

  String get verificationFailed;

  String get pleaseEnterPhone;

  String get enterValidPhone;

  String phoneMustBeExactDigits(int digitCount);

  String get phoneMustBeDigits;

  String get autoVerificationFailed;

  String get protectedDriverAccess;

  String get verifyOtp;

  String get enterOtp;

  String sentTo(String phoneNumber);

  String get invalidOtp;

  String get codeExpired;

  String get verificationFailedMsg;

  String get couldNotVerifyOtp;

  String get verifying;

  String get home;

  String get trips;

  String get earnings;

  String get profile;

  String get offlineUsingCachedData;

  String get newLoadAvailable;

  String get view;

  String get navigationActive;

  String headingTo(String destination);

  String get locating;

  String get locationUnavailable;

  String get currentLocation;

  String get tapToRefresh;

  String get fetchingLocation;

  String get whereAreYouHeading;

  String get onlineAndReady;

  String get offline;

  String get offlineGoOnline;

  String get radarActiveFetching;

  String get radarActiveLooking;

  String get todayPay;

  String get shiftHours;

  String get rating;

  String get metricsUnavailable;

  String get noDestinationAvailable;

  String get currentLocationUnavailable;

  String get unableToOpenGoogleMaps;

  String get failedToGenerateRoute;

  String get enRoute;

  String get assignedLoad;

  String get distance;

  String get estDuration;

  String get estPayout;

  String get slideToCompleteTrip;

  String get slideToStartTrip;

  String get cancelAssignment;

  String tripCompletedNetEarnings(String amount);

  String get failedToCompleteTrip;

  String get failedToStartTrip;

  String get tripCompleted;

  String get pleaseGoOnline;

  String get noDestinationAvailable2;

  String get locationPermissionRequired;

  String get locationAccessDenied;

  String get locationPermDenied;

  String get openSettings;

  String get editProfile;

  String get fullNames;

  String get phoneNumbers;

  String get emailAddress;

  String get vehicleRegistrationNumber;

  String get saveChanges;

  String get profileUpdatedSuccessfully;

  String get selectLanguage;

  String get applyLanguage;

  String get languageSwitched;

  String get polygonWalletAddress;

  String get saveWalletAddress;

  String get walletAddressUpdated;

  String get failedToUpdateWallet;

  String get helpSupport;

  String get browseFAQs;

  String get instantAnswers;

  String get aboutTruxifyDriverApp;

  String get truxifyDescription;

  String get documents;

  String get driverLicensePermitPapers;

  String get notifications;

  String get viewTripAlerts;

  String get walletAddress;

  String get notSet;

  String get languageLabel;

  String get helpAndSupport247;

  String get versionAndAppInfo;

  String get logout;

  String get logoutFailed;

  String get myTrips;

  String get marketplace;

  String get sortTrips;

  String get newestFirst;

  String get oldestFirst;

  String get highestEarnings;

  String get lowestEarnings;

  String get byStatus;

  String get totalTrips;

  String get totalEarned;

  String get completion;

  String get all;

  String get active2;

  String get completed2;

  String get cancelled2;

  String get failedToLoadTrips;

  String get pullDownToRetry;

  String get noTripsFound;

  String get deliveryStops;

  String get markCurrentStopCompleted;

  String get activeStatus;

  String get completedStatus;

  String get cancelledStatus;

  String get enRouteOpportunities;

  String get pickupNearbyLoads;

  String get marketplaceLoads;

  String get availableLoadsYouCanBidFor;

  String get couldNotLoadMarketplace;

  String get pullToRefresh;

  String get noLoadsAvailable;

  String get bidSubmitted;

  String get failedToSubmitBid;

  String get thisLoadIsMissingId;

  String get recommendedReturnLoads;

  String get recommendedForYou;

  String get matchScore;

  String get bestMatch;

  String get noRecommendations;

  String get couldNotLoadRecommendations;

  String get noActiveTripForRecommendations;

  String get detourDistance;

  String get bidOnLoad;

  String get updateBid;

  String get placeYourBid;

  String get bidAmount;

  String get submitBid;

  String get enterValidBid;
  String get unableToOpen;
  String get withdraw;

  String get withdrawFunds;

  String get availableBalance;

  String get enterAmount;

  String get amountRequired;

  String get enterValidAmount;

  String get amountMustBePositive;

  String get insufficientBalance;

  String get max;

  String get withdrawalSuccessful;
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
  // Lookup logic when only language code is specified.
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
