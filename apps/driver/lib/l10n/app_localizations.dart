import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_hi.dart';
import 'app_localizations_ta.dart';
import 'app_localizations_kn.dart';
import 'app_localizations_mr.dart';

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
    Locale('ta'),
    Locale('kn'),
    Locale('mr'),
  ];

  /// The title of the driver application
  String get appTitle;

  /// General loading indicator text
  String get loadingText;

  /// Button label to retry a failed action
  String get retry;

  /// Generic error title
  String get error;

  /// Button label to cancel an action
  String get cancel;

  /// Button label to save changes
  String get save;

  /// Button label to close a dialog or screen
  String get close;

  /// Button label to apply a selection or setting
  String get apply;

  /// Button label to reset filters or form fields
  String get reset;

  /// Placeholder text for search input fields
  String get search;

  /// Greeting on the login screen
  String get welcomeDriver;

  /// Subtitle on the login screen encouraging sign-in
  String get logInToStartEarning;

  /// Label for the phone number input field
  String get phoneNumber;

  /// Button label to send a one-time password
  String get sendOtp;

  /// Status text while an OTP is being sent
  String get sending;

  /// Error message when login verification fails
  String get verificationFailed;

  /// Validation message when phone field is empty
  String get pleaseEnterPhone;

  /// Validation message for invalid phone format
  String get enterValidPhone;

  /// Validation message for incorrect phone number length
  String phoneMustBeExactDigits(int digitCount);

  /// Validation message when phone contains non-digit characters
  String get phoneMustBeDigits;

  /// Message shown when automatic OTP detection fails
  String get autoVerificationFailed;

  /// Message indicating driver-only access
  String get protectedDriverAccess;

  /// Title of the OTP verification screen
  String get verifyOtp;

  /// Instruction text on the OTP screen
  String get enterOtp;

  /// Text showing which phone number the OTP was sent to
  String sentTo(String phoneNumber);

  /// Error message for incorrect OTP entry
  String get invalidOtp;

  /// Message when the OTP code has expired
  String get codeExpired;

  /// General verification failure message on OTP screen
  String get verificationFailedMsg;

  /// Error message when OTP verification request fails
  String get couldNotVerifyOtp;

  /// Status text while OTP is being verified
  String get verifying;

  /// Navigation label for the Home tab
  String get home;

  /// Navigation label for the Trips tab
  String get trips;

  /// Navigation label for the Earnings tab
  String get earnings;

  /// Navigation label for the Profile tab
  String get profile;

  /// Banner text when app is in offline mode
  String get offlineUsingCachedData;

  /// Notification text when a new load appears
  String get newLoadAvailable;

  /// Button label to view details
  String get view;

  /// Status text when GPS navigation is active
  String get navigationActive;

  /// Text showing the current trip destination
  String headingTo(String destination);

  /// Status text while GPS is determining position
  String get locating;

  /// Error text when GPS cannot determine position
  String get locationUnavailable;

  /// Label for the driver's current GPS location
  String get currentLocation;

  /// Instruction text to pull-to-refresh
  String get tapToRefresh;

  /// Status text while location is being fetched
  String get fetchingLocation;

  /// Prompt for destination input
  String get whereAreYouHeading;

  /// Status text when driver is online and available
  String get onlineAndReady;

  /// Status text when driver is offline
  String get offline;

  /// Message encouraging driver to go online
  String get offlineGoOnline;

  /// Status text while radar is scanning for loads
  String get radarActiveFetching;

  /// Status text when radar is actively searching
  String get radarActiveLooking;

  /// Label for today's earnings display
  String get todayPay;

  /// Label for hours worked display
  String get shiftHours;

  /// Label for driver rating display
  String get rating;

  /// Text when dashboard metrics cannot be loaded
  String get metricsUnavailable;

  /// Text when no destination has been entered
  String get noDestinationAvailable;

  /// Error text when current GPS location is unavailable
  String get currentLocationUnavailable;

  /// Error message when Google Maps launch fails
  String get unableToOpenGoogleMaps;

  /// Error message when route generation fails
  String get failedToGenerateRoute;

  /// Status label when driver is en route to destination
  String get enRoute;

  /// Label for the currently assigned load
  String get assignedLoad;

  /// Label for trip distance
  String get distance;

  /// Label for estimated trip duration
  String get estDuration;

  /// Label for estimated trip payout
  String get estPayout;

  /// Instruction on the slide-to-confirm button to complete
  String get slideToCompleteTrip;

  /// Instruction on the slide-to-confirm button to start
  String get slideToStartTrip;

  /// Button label to cancel a trip assignment
  String get cancelAssignment;

  /// Success message after trip completion with earnings
  String tripCompletedNetEarnings(String amount);

  /// Error message when trip completion fails
  String get failedToCompleteTrip;

  /// Error message when trip start fails
  String get failedToStartTrip;

  /// Title or status for a completed trip
  String get tripCompleted;

  /// Prompt asking the driver to go online before proceeding
  String get pleaseGoOnline;

  /// Message when no destination is set for navigation
  String get noDestinationAvailable2;

  /// Error message when location permission has not been granted
  String get locationPermissionRequired;

  /// Error message when location access is denied by user
  String get locationAccessDenied;

  /// Error message when location permission is permanently denied
  String get locationPermDenied;

  /// Button label to open device settings
  String get openSettings;

  /// Title or button label to edit the driver profile
  String get editProfile;

  /// Label for the full name input field
  String get fullNames;

  /// Label for the phone number display
  String get phoneNumbers;

  /// Label for the email address input field
  String get emailAddress;

  /// Label for the vehicle registration input field
  String get vehicleRegistrationNumber;

  /// Button label to save profile changes
  String get saveChanges;

  /// Success message after profile update
  String get profileUpdatedSuccessfully;

  /// Title or label for language selection
  String get selectLanguage;

  /// Button label to confirm language change
  String get applyLanguage;

  /// Success message after language change
  String get languageSwitched;

  /// Label for the Polygon wallet address field
  String get polygonWalletAddress;

  /// Button label to save the wallet address
  String get saveWalletAddress;

  /// Success message after wallet address update
  String get walletAddressUpdated;

  /// Error message when wallet address update fails
  String get failedToUpdateWallet;

  /// Section title for help and support
  String get helpSupport;

  /// Button label to view frequently asked questions
  String get browseFAQs;

  /// Subtitle describing the FAQ section
  String get instantAnswers;

  /// Section title for app about information
  String get aboutTruxifyDriverApp;

  /// Description of the Truxify application
  String get truxifyDescription;

  /// Section title for driver documents
  String get documents;

  /// Label for driver license and permit document section
  String get driverLicensePermitPapers;

  /// Section title for notifications settings
  String get notifications;

  /// Label for trip notification alerts toggle
  String get viewTripAlerts;

  /// Label for wallet address display
  String get walletAddress;

  /// Placeholder text when a value has not been set
  String get notSet;

  /// Label for the current language setting
  String get languageLabel;

  /// Label indicating round-the-clock support availability
  String get helpAndSupport247;

  /// Label for app version information section
  String get versionAndAppInfo;

  /// Button label to log out of the application
  String get logout;

  /// Error message when logout fails
  String get logoutFailed;

  /// Title of the trips screen
  String get myTrips;

  /// Title or tab for the load marketplace
  String get marketplace;

  /// Label for the trip sorting option
  String get sortTrips;

  /// Sort option to show newest trips first
  String get newestFirst;

  /// Sort option to show oldest trips first
  String get oldestFirst;

  /// Sort option to show highest-earning trips first
  String get highestEarnings;

  /// Sort option to show lowest-earning trips first
  String get lowestEarnings;

  /// Sort or filter option to group trips by status
  String get byStatus;

  /// Label for total number of trips
  String get totalTrips;

  /// Label for total earnings amount
  String get totalEarned;

  /// Label for trip completion percentage
  String get completion;

  /// Filter option to show all trips
  String get all;

  /// Filter option to show active trips
  String get active2;

  /// Filter option to show completed trips
  String get completed2;

  /// Filter option to show cancelled trips
  String get cancelled2;

  /// Error message when trips list fails to load
  String get failedToLoadTrips;

  /// Instruction text for pull-to-refresh gesture
  String get pullDownToRetry;

  /// Empty state text when no trips match filters
  String get noTripsFound;

  /// Label for the number of delivery stops on a trip
  String get deliveryStops;

  /// Button label to mark the current delivery stop as done
  String get markCurrentStopCompleted;

  /// Status badge text for an active trip
  String get activeStatus;

  /// Status badge text for a completed trip
  String get completedStatus;

  /// Status badge text for a cancelled trip
  String get cancelledStatus;

  /// Section title for loads available along current route
  String get enRouteOpportunities;

  /// Label for nearby load pickup section
  String get pickupNearbyLoads;

  /// Section title for marketplace load listings
  String get marketplaceLoads;

  /// Subtitle describing available marketplace loads
  String get availableLoadsYouCanBidFor;

  /// Error message when marketplace data fails to load
  String get couldNotLoadMarketplace;

  /// Instruction text to refresh marketplace data
  String get pullToRefresh;

  /// Empty state text when no loads are available
  String get noLoadsAvailable;

  /// Success message after submitting a bid
  String get bidSubmitted;

  /// Error message when bid submission fails
  String get failedToSubmitBid;

  /// Error message when a load record has no valid identifier
  String get thisLoadIsMissingId;

  /// Section title for ML-powered return load recommendations
  String get recommendedReturnLoads;

  /// Label shown when a recommendation has no route
  String get recommendedForYou;

  /// Label for ML match score percentage
  String get matchScore;

  /// Label for the top recommendation
  String get bestMatch;

  /// Empty state when ML returns no recommendations
  String get noRecommendations;

  /// Error state when ML endpoint fails
  String get couldNotLoadRecommendations;

  /// Hint shown when driver has no active trip for recommendations
  String get noActiveTripForRecommendations;

  /// Label for detour distance
  String get detourDistance;

  /// Button label to place a bid on a load
  String get bidOnLoad;

  /// Button label to update an existing bid
  String get updateBid;

  /// Title of the bid placement bottom sheet
  String get placeYourBid;

  /// Label for the bid amount input field
  String get bidAmount;

  /// Button label to submit a bid
  String get submitBid;

  /// Validation message for invalid bid input
  String get enterValidBid;

  /// Error message when a notification cannot be navigated to
  String get unableToOpen;

  /// Button label to withdraw funds from wallet
  String get withdraw;

  /// Title of the withdrawal bottom sheet
  String get withdrawFunds;

  /// Label for the confirmed wallet balance in the withdrawal sheet
  String get availableBalance;

  /// Label for the amount input field in the withdrawal sheet
  String get enterAmount;

  /// Validation error when amount field is empty
  String get amountRequired;

  /// Validation error when amount is not a valid number
  String get enterValidAmount;

  /// Validation error when amount is zero or negative
  String get amountMustBePositive;

  /// Validation error when amount exceeds confirmed balance
  String get insufficientBalance;

  /// Label for the quick-fill button that sets the maximum withdrawal amount
  String get max;

  /// Success message after a successful withdrawal
  String get withdrawalSuccessful;

  /// Error message when network connection fails
  String get networkError;

  /// Label for the theme selection setting
  String get theme;

  /// System theme option label
  String get system;

  /// Light theme option label
  String get light;

  /// Dark theme option label
  String get dark;

  /// Snackbar message shown when the OTP is resent to the driver's phone.
  String get otpResent;

  /// Countdown label shown while the resend cooldown timer is running.
  String resendOtpIn(int seconds);

  /// Label for the button that resends the OTP to the driver's phone.
  String get resendOtp;

  /// Language selection setting
  String get language;

  /// English language name
  String get english;

  /// Hindi language name
  String get hindi;

  /// Tamil language name
  String get tamil;
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
      <String>['en', 'hi', 'ta', 'kn', 'mr'].contains(locale.languageCode);

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
    case 'ta':
      return AppLocalizationsTa();
    case 'kn':
      return AppLocalizationsKn();
    case 'mr':
      return AppLocalizationsMr();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
