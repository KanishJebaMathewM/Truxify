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

  /// The title of the application
  String get appTitle;

  /// Greeting title on the login screen
  String get loginTitle;

  /// Text for the book a load button
  String get bookLoadButton;

  /// Generic loading indicator text
  String get loadingText;

  /// Coming soon message
  String comingSoon(String title);

  /// Greeting message with name
  String greetingMessage(String greeting, String displayName);

  /// Text shown when there are no active shipments
  String get noActiveShipments;

  /// Text shown for route history placeholder
  String get routeHistoryComingSoon;

  /// Success message when wallet address is updated
  String get walletAddressUpdated;

  /// Label for the Polygon wallet address field
  String get polygonWalletAddress;

  /// Button text to save wallet address
  String get saveWalletAddress;

  /// Error message format
  String error(String errorMsg);

  /// Light theme option
  String get lightTheme;

  /// Dark theme option
  String get darkTheme;

  /// Button text to retry a failed action
  String get retry;

  /// Button text to cancel an action
  String get cancel;

  /// Generic save button text
  String get save;

  /// Button text to close a dialog or sheet
  String get close;

  /// Button text to apply filters or settings
  String get apply;

  /// Button text to reset filters or form fields
  String get reset;

  /// Placeholder text for search input
  String get search;

  /// Subtitle greeting on login screen for returning users
  String get welcomeBack;

  /// Subtitle text below the login title
  String get signInSubtitle;

  /// Label for phone number input field
  String get phoneNumber;

  /// Button text to send a one-time password
  String get sendOtp;

  /// Loading text while OTP is being sent
  String get sendingOtp;

  /// Loading text while OTP is being verified
  String get verifyingOtp;

  /// Button text to verify the entered OTP
  String get verifyOtp;

  /// Button text to login using biometric authentication
  String get loginWithBiometrics;

  /// Message shown when device does not support biometric auth
  String get biometricsNotSupported;

  /// Success message after biometric authentication
  String get biometricAuthSuccessful;

  /// Validation message when phone number field is empty
  String get pleaseEnterPhone;

  /// Validation message when phone number contains non-digit characters
  String get phoneDigitsOnly;

  /// Validation message when phone number does not have the exact required digit count
  String phoneMustBeExactDigits(int digitCount);

  /// Validation message when phone number contains non-digit characters
  String get phoneMustBeDigits;

  /// Generic verification failure message
  String get verificationFailed;

  /// Message shown when phone OTP verification fails
  String get phoneVerificationFailed;

  /// Message shown when automatic OTP detection fails
  String get autoVerificationFailed;

  /// Error message when OTP sending fails
  String get failedToSendOtp;

  /// Label for OTP input field
  String get enterOtp;

  /// Text indicating where the OTP was sent
  String sentTo(String phoneNumber);

  /// Error message when entered OTP is invalid
  String get invalidOtp;

  /// Message shown when the verification session times out
  String get verificationSessionExpired;

  /// Error message for an invalid verification code
  String get invalidVerificationCode;

  /// Message shown when the OTP has expired
  String get otpExpired;

  /// Bottom navigation tab label for home
  String get home;

  /// Bottom navigation tab label and screen title for finding trucks
  String get findTrucks;

  /// Bottom navigation tab label for orders
  String get orders;

  /// Bottom navigation tab label for profile
  String get profile;

  /// Section title for active shipments on home screen
  String get activeShipments;

  /// Link text to view all items in a list
  String get seeAll;

  /// Button or card text to book a truck
  String get bookATruck;

  /// Badge or status label for active items
  String get active;

  /// Button text to view more statistics
  String get moreStats;

  /// Label for savings summary on home screen
  String get savings;

  /// Label for total shipments count on home screen
  String get totalShipments;

  /// Section title for frequently used routes
  String get yourUsualRoutes;

  /// Label for the last known truck location
  String get lastTruckLocation;

  /// Error message when data loading fails
  String get couldNotLoadData;

  /// Subtitle indicating AI-based truck matching
  String get mlPoweredMatching;

  /// Label for route section
  String get route;

  /// Label for pickup location input
  String get pickupLocation;

  /// Label for drop location input
  String get dropLocation;

  /// Label for date picker
  String get date;

  /// Label for time picker
  String get time;

  /// Section title for goods information
  String get goodsDetails;

  /// Label for goods type selector
  String get goodsType;

  /// Label for weight input in tonnes
  String get weightTonnes;

  /// Label for length input in feet
  String get lengthFt;

  /// Label for width input in feet
  String get widthFt;

  /// Label for height input in feet
  String get heightFt;

  /// Label for stackable goods option
  String get stackable;

  /// Label for fragile goods option
  String get fragile;

  /// Label for special requirements text field
  String get specialRequirements;

  /// Label for the estimated price display
  String get estimatedPriceRange;

  /// Indicator that the price has been stable this week
  String get stableThisWeek;

  /// Loading text while price is being estimated
  String get estimatingPrice;

  /// Text shown when a price estimate cannot be generated
  String get estimateUnavailable;

  /// Prompt text to encourage user to fill in route details
  String get enterRouteDetails;

  /// Subtext indicating price estimate is based on demand
  String get basedOnCurrentDemand;

  /// Button text to open truck filter options
  String get filterTrucks;

  /// Label for truck type filter
  String get truckType;

  /// Label for truck capacity filter in tonnes
  String get capacityTonnes;

  /// Label for material type filter
  String get materialType;

  /// Date selection option for today
  String get today;

  /// Date selection option for tomorrow
  String get tomorrow;

  /// Button text to select pickup location on map
  String get selectPickupOnMap;

  /// Button text to select drop location on map
  String get selectDropOnMap;

  /// Label for temperature controlled truck option
  String get temperatureControl;

  /// Label for waterproof cover truck option
  String get waterproofCover;

  /// Label for loading assistance option
  String get loadingHelp;

  /// Indicator that loading assistance is required
  String get loadingHelpNeeded;

  /// Generic option for other/miscellaneous selection
  String get other;

  /// Placeholder text for goods description input
  String get describeYourGoods;

  /// Tab label for active orders
  String get activeTab;

  /// Tab label for order history
  String get historyTab;

  /// Placeholder text for order search input
  String get searchOrdersHint;

  /// Text shown when there are no active orders
  String get noActiveOrders;

  /// Text shown when there is no order history
  String get noHistoryOrders;

  /// Label indicating the app is in offline mode
  String get offlineMode;

  /// Text showing when data was last updated
  String lastUpdated(String timeAgo);

  /// Order status label when a driver has been assigned
  String get driverAssigned;

  /// Order status label when shipment is in transit
  String get inTransit;

  /// Order status label when payment has been released
  String get paymentReleased;

  /// Order status label for completed delivery
  String get delivered;

  /// Order status label for cancelled orders
  String get cancelled;

  /// Order status label for pending orders
  String get pending;

  /// Profile section title for account settings
  String get account;

  /// Profile section title for app preferences
  String get preferences;

  /// Profile menu item for payment methods
  String get paymentMethods;

  /// Profile menu item for documents
  String get myDocuments;

  /// Profile menu item for saved addresses
  String get savedAddresses;

  /// Label for wallet address in profile
  String get walletAddressLabel;

  /// Text shown when a field has not been configured
  String get notSet;

  /// Profile menu item for language settings
  String get language;

  /// Profile menu item for help and support
  String get helpSupport;

  /// Profile menu item for about page
  String get aboutTruxify;

  /// Button text to log out of the app
  String get logout;

  /// Label indicating offline mode with last updated time
  String offlineModeLabel(String timeAgo);

  /// Label for orders count or section in profile
  String get ordersLabel;

  /// Label for saved items count in profile
  String get savedLabel;

  /// Label for CO2 emissions saved metric
  String get co2Label;

  /// Button text to edit profile information
  String get editProfile;

  /// Label for full name input field
  String get fullName;

  /// Label for company name input field
  String get companyName;

  /// Label for phone number display or input
  String get phone;

  /// Placeholder text for full name input
  String get enterFullName;

  /// Placeholder text for company name input
  String get enterCompanyName;

  /// Placeholder text for phone number input
  String get enterPhoneNumber;

  /// Validation error when name field is empty
  String get nameIsRequired;

  /// Validation error when company name field is empty
  String get companyNameIsRequired;

  /// Validation error when phone number field is empty
  String get phoneNumberIsRequired;

  /// Loading text while profile changes are being saved
  String get saving;

  /// Button text to save profile changes
  String get saveChanges;

  /// Success message after profile is updated
  String get profileUpdatedSuccessfully;

  /// Error message when profile data fails to load
  String get failedToLoadProfile;

  /// Error message when profile update fails
  String get failedToUpdateProfile;

  /// Button text to share order tracking link
  String get shareTracking;

  /// Success message when tracking link is generated
  String get trackingLinkGenerated;

  /// Error message when sharing fails
  String get unableToShare;

  /// Message shown when a tracking link has expired
  String get linkExpired;

  /// Message shown when tracking links are revoked
  String get trackingRevoked;

  /// Button text to copy tracking link to clipboard
  String get copyLink;

  /// Default message included when sharing tracking link
  String get shareMessage;

  /// Error message when an order referenced by a notification cannot be found
  String get orderNotFound;

  /// Title for notification-related UI elements
  String get notification;

  /// Error message when a notification cannot be navigated to
  String get unableToOpen;

  /// Button text to download the order invoice as PDF
  String get downloadInvoice;

  /// Status text while the PDF invoice is being generated
  String get generatingInvoice;

  /// Success message after invoice PDF is generated
  String get invoiceReady;

  /// Button text to share the generated invoice
  String get shareInvoice;

  /// Button text to print the generated invoice
  String get printInvoice;

  /// Error message when invoice download or generation fails
  String get downloadFailed;

  /// Error message when network connection fails
  String get networkError;
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
