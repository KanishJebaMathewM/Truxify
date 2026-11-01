import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_hi.dart';
import 'app_localizations_kn.dart';
import 'app_localizations_mr.dart';
import 'app_localizations_ta.dart';

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
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
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
    Locale('kn'),
    Locale('mr'),
    Locale('ta')
  ];

  /// The title of the application
  ///
  /// In en, this message translates to:
  /// **'Truxify'**
  String get appTitle;

  /// Greeting title on the login screen
  ///
  /// In en, this message translates to:
  /// **'Welcome to Truxify'**
  String get loginTitle;

  /// Text for the book a load button
  ///
  /// In en, this message translates to:
  /// **'Book a Load'**
  String get bookLoadButton;

  /// Generic loading indicator text
  ///
  /// In en, this message translates to:
  /// **'Loading...'**
  String get loadingText;

  /// Coming soon message
  ///
  /// In en, this message translates to:
  /// **'{title} coming soon'**
  String comingSoon(String title);

  /// Greeting message with name
  ///
  /// In en, this message translates to:
  /// **'{greeting}, {displayName} 👋'**
  String greetingMessage(String greeting, String displayName);

  /// Text shown when there are no active shipments
  ///
  /// In en, this message translates to:
  /// **'No active shipments'**
  String get noActiveShipments;

  /// Text shown for route history placeholder
  ///
  /// In en, this message translates to:
  /// **'Route history coming soon'**
  String get routeHistoryComingSoon;

  /// Success message when wallet address is updated
  ///
  /// In en, this message translates to:
  /// **'Wallet address updated'**
  String get walletAddressUpdated;

  /// Label for the Polygon wallet address field
  ///
  /// In en, this message translates to:
  /// **'Polygon Wallet Address'**
  String get polygonWalletAddress;

  /// Button text to save wallet address
  ///
  /// In en, this message translates to:
  /// **'Save Wallet Address'**
  String get saveWalletAddress;

  /// Error message format
  ///
  /// In en, this message translates to:
  /// **'Error: {errorMsg}'**
  String error(String errorMsg);

  /// Light theme option
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get lightTheme;

  /// Dark theme option
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get darkTheme;

  /// Button text to retry a failed action
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get retry;

  /// Button text to cancel an action
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// Generic save button text
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// Button text to close a dialog or sheet
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get close;

  /// Button text to apply filters or settings
  ///
  /// In en, this message translates to:
  /// **'Apply'**
  String get apply;

  /// Button text to reset filters or form fields
  ///
  /// In en, this message translates to:
  /// **'Reset'**
  String get reset;

  /// Placeholder text for search input
  ///
  /// In en, this message translates to:
  /// **'Search'**
  String get search;

  /// Subtitle greeting on login screen for returning users
  ///
  /// In en, this message translates to:
  /// **'Welcome Back'**
  String get welcomeBack;

  /// Subtitle text below the login title
  ///
  /// In en, this message translates to:
  /// **'Sign in to continue'**
  String get signInSubtitle;

  /// Label for phone number input field
  ///
  /// In en, this message translates to:
  /// **'Phone Number'**
  String get phoneNumber;

  /// Button text to send a one-time password
  ///
  /// In en, this message translates to:
  /// **'Send OTP'**
  String get sendOtp;

  /// Loading text while OTP is being sent
  ///
  /// In en, this message translates to:
  /// **'Sending OTP...'**
  String get sendingOtp;

  /// Loading text while OTP is being verified
  ///
  /// In en, this message translates to:
  /// **'Verifying...'**
  String get verifyingOtp;

  /// Button text to verify the entered OTP
  ///
  /// In en, this message translates to:
  /// **'Verify OTP'**
  String get verifyOtp;

  /// Button text to login using biometric authentication
  ///
  /// In en, this message translates to:
  /// **'Login with Biometrics'**
  String get loginWithBiometrics;

  /// Message shown when device does not support biometric auth
  ///
  /// In en, this message translates to:
  /// **'Biometrics not supported on this device'**
  String get biometricsNotSupported;

  /// Success message after biometric authentication
  ///
  /// In en, this message translates to:
  /// **'Biometric authentication successful'**
  String get biometricAuthSuccessful;

  /// Message shown when biometric success has no cached session to re-authenticate
  ///
  /// In en, this message translates to:
  /// **'No saved session found. Please sign in with your phone number first.'**
  String get biometricAuthRequiresSession;

  /// Validation message when phone number field is empty
  ///
  /// In en, this message translates to:
  /// **'Please enter your phone number'**
  String get pleaseEnterPhone;

  /// Validation message when phone number contains non-digit characters
  ///
  /// In en, this message translates to:
  /// **'Phone number must contain digits only'**
  String get phoneDigitsOnly;

  /// Validation message when phone number does not have the exact required digit count
  ///
  /// In en, this message translates to:
  /// **'Phone number must be exactly {digitCount} digits'**
  String phoneMustBeExactDigits(int digitCount);

  /// Validation message when phone number contains non-digit characters
  ///
  /// In en, this message translates to:
  /// **'Phone number must contain only digits'**
  String get phoneMustBeDigits;

  /// Generic verification failure message
  ///
  /// In en, this message translates to:
  /// **'Verification failed. Please try again.'**
  String get verificationFailed;

  /// Message shown when phone OTP verification fails
  ///
  /// In en, this message translates to:
  /// **'Phone verification failed. Please try again.'**
  String get phoneVerificationFailed;

  /// Message shown when automatic OTP detection fails
  ///
  /// In en, this message translates to:
  /// **'Auto-verification failed. Please enter the OTP manually.'**
  String get autoVerificationFailed;

  /// Error message when OTP sending fails
  ///
  /// In en, this message translates to:
  /// **'Failed to send OTP. Please try again.'**
  String get failedToSendOtp;

  /// Label for OTP input field
  ///
  /// In en, this message translates to:
  /// **'Enter OTP'**
  String get enterOtp;

  /// Text indicating where the OTP was sent
  ///
  /// In en, this message translates to:
  /// **'Sent to {phoneNumber}'**
  String sentTo(String phoneNumber);

  /// Error message when entered OTP is invalid
  ///
  /// In en, this message translates to:
  /// **'Invalid OTP. Please check and try again.'**
  String get invalidOtp;

  /// Message shown when the verification session times out
  ///
  /// In en, this message translates to:
  /// **'Verification session has expired. Please request a new OTP.'**
  String get verificationSessionExpired;

  /// Error message for an invalid verification code
  ///
  /// In en, this message translates to:
  /// **'Invalid verification code.'**
  String get invalidVerificationCode;

  /// Message shown when the OTP has expired
  ///
  /// In en, this message translates to:
  /// **'OTP has expired. Please request a new one.'**
  String get otpExpired;

  /// Bottom navigation tab label for home
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get home;

  /// Bottom navigation tab label and screen title for finding trucks
  ///
  /// In en, this message translates to:
  /// **'Find Trucks'**
  String get findTrucks;

  /// Bottom navigation tab label for orders
  ///
  /// In en, this message translates to:
  /// **'Orders'**
  String get orders;

  /// Bottom navigation tab label for profile
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profile;

  /// Section title for active shipments on home screen
  ///
  /// In en, this message translates to:
  /// **'Active Shipments'**
  String get activeShipments;

  /// Link text to view all items in a list
  ///
  /// In en, this message translates to:
  /// **'See All'**
  String get seeAll;

  /// Button or card text to book a truck
  ///
  /// In en, this message translates to:
  /// **'Book a Truck'**
  String get bookATruck;

  /// Badge or status label for active items
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get active;

  /// Button text to view more statistics
  ///
  /// In en, this message translates to:
  /// **'More Stats'**
  String get moreStats;

  /// Label for savings summary on home screen
  ///
  /// In en, this message translates to:
  /// **'Savings'**
  String get savings;

  /// Label for total shipments count on home screen
  ///
  /// In en, this message translates to:
  /// **'Total Shipments'**
  String get totalShipments;

  /// Section title for frequently used routes
  ///
  /// In en, this message translates to:
  /// **'Your Usual Routes'**
  String get yourUsualRoutes;

  /// Label for the last known truck location
  ///
  /// In en, this message translates to:
  /// **'Last Truck Location'**
  String get lastTruckLocation;

  /// Error message when data loading fails
  ///
  /// In en, this message translates to:
  /// **'Could not load data'**
  String get couldNotLoadData;

  /// Subtitle indicating AI-based truck matching
  ///
  /// In en, this message translates to:
  /// **'ML-Powered Matching'**
  String get mlPoweredMatching;

  /// Label for route section
  ///
  /// In en, this message translates to:
  /// **'Route'**
  String get route;

  /// Label for pickup location input
  ///
  /// In en, this message translates to:
  /// **'Pickup Location'**
  String get pickupLocation;

  /// Label for drop location input
  ///
  /// In en, this message translates to:
  /// **'Drop Location'**
  String get dropLocation;

  /// Label for date picker
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get date;

  /// Label for time picker
  ///
  /// In en, this message translates to:
  /// **'Time'**
  String get time;

  /// Section title for goods information
  ///
  /// In en, this message translates to:
  /// **'Goods Details'**
  String get goodsDetails;

  /// Label for goods type selector
  ///
  /// In en, this message translates to:
  /// **'Goods Type'**
  String get goodsType;

  /// Label for weight input in tonnes
  ///
  /// In en, this message translates to:
  /// **'Weight (Tonnes)'**
  String get weightTonnes;

  /// Label for length input in feet
  ///
  /// In en, this message translates to:
  /// **'Length (ft)'**
  String get lengthFt;

  /// Label for width input in feet
  ///
  /// In en, this message translates to:
  /// **'Width (ft)'**
  String get widthFt;

  /// Label for height input in feet
  ///
  /// In en, this message translates to:
  /// **'Height (ft)'**
  String get heightFt;

  /// Label for stackable goods option
  ///
  /// In en, this message translates to:
  /// **'Stackable'**
  String get stackable;

  /// Label for fragile goods option
  ///
  /// In en, this message translates to:
  /// **'Fragile'**
  String get fragile;

  /// Label for special requirements text field
  ///
  /// In en, this message translates to:
  /// **'Special Requirements'**
  String get specialRequirements;

  /// Label for the estimated price display
  ///
  /// In en, this message translates to:
  /// **'Estimated Price Range'**
  String get estimatedPriceRange;

  /// Indicator that the price has been stable this week
  ///
  /// In en, this message translates to:
  /// **'Stable this week'**
  String get stableThisWeek;

  /// Loading text while price is being estimated
  ///
  /// In en, this message translates to:
  /// **'Estimating price...'**
  String get estimatingPrice;

  /// Text shown when a price estimate cannot be generated
  ///
  /// In en, this message translates to:
  /// **'Estimate unavailable'**
  String get estimateUnavailable;

  /// Prompt text to encourage user to fill in route details
  ///
  /// In en, this message translates to:
  /// **'Enter route details to get started'**
  String get enterRouteDetails;

  /// Subtext indicating price estimate is based on demand
  ///
  /// In en, this message translates to:
  /// **'Based on current demand'**
  String get basedOnCurrentDemand;

  /// Button text to open truck filter options
  ///
  /// In en, this message translates to:
  /// **'Filter Trucks'**
  String get filterTrucks;

  /// Label for truck type filter
  ///
  /// In en, this message translates to:
  /// **'Truck Type'**
  String get truckType;

  /// Label for truck capacity filter in tonnes
  ///
  /// In en, this message translates to:
  /// **'Capacity (Tonnes)'**
  String get capacityTonnes;

  /// Label for material type filter
  ///
  /// In en, this message translates to:
  /// **'Material Type'**
  String get materialType;

  /// Date selection option for today
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get today;

  /// Date selection option for tomorrow
  ///
  /// In en, this message translates to:
  /// **'Tomorrow'**
  String get tomorrow;

  /// Button text to select pickup location on map
  ///
  /// In en, this message translates to:
  /// **'Select Pickup on Map'**
  String get selectPickupOnMap;

  /// Button text to select drop location on map
  ///
  /// In en, this message translates to:
  /// **'Select Drop on Map'**
  String get selectDropOnMap;

  /// Label for temperature controlled truck option
  ///
  /// In en, this message translates to:
  /// **'Temperature Control'**
  String get temperatureControl;

  /// Label for waterproof cover truck option
  ///
  /// In en, this message translates to:
  /// **'Waterproof Cover'**
  String get waterproofCover;

  /// Label for loading assistance option
  ///
  /// In en, this message translates to:
  /// **'Loading Help'**
  String get loadingHelp;

  /// Indicator that loading assistance is required
  ///
  /// In en, this message translates to:
  /// **'Loading help needed'**
  String get loadingHelpNeeded;

  /// Generic option for other/miscellaneous selection
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get other;

  /// Placeholder text for goods description input
  ///
  /// In en, this message translates to:
  /// **'Describe your goods...'**
  String get describeYourGoods;

  /// Tab label for active orders
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get activeTab;

  /// Tab label for order history
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get historyTab;

  /// Placeholder text for order search input
  ///
  /// In en, this message translates to:
  /// **'Search orders...'**
  String get searchOrdersHint;

  /// Text shown when there are no active orders
  ///
  /// In en, this message translates to:
  /// **'No active orders'**
  String get noActiveOrders;

  /// Text shown when there is no order history
  ///
  /// In en, this message translates to:
  /// **'No order history'**
  String get noHistoryOrders;

  /// Label indicating the app is in offline mode
  ///
  /// In en, this message translates to:
  /// **'Offline Mode'**
  String get offlineMode;

  /// Text showing when data was last updated
  ///
  /// In en, this message translates to:
  /// **'Last updated {timeAgo}'**
  String lastUpdated(String timeAgo);

  /// Order status label when a driver has been assigned
  ///
  /// In en, this message translates to:
  /// **'Driver Assigned'**
  String get driverAssigned;

  /// Order status label when shipment is in transit
  ///
  /// In en, this message translates to:
  /// **'In Transit'**
  String get inTransit;

  /// Order status label when payment has been released
  ///
  /// In en, this message translates to:
  /// **'Payment Released'**
  String get paymentReleased;

  /// Order status label for completed delivery
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get delivered;

  /// Order status label for cancelled orders
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get cancelled;

  /// Order status label for pending orders
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get pending;

  /// Profile section title for account settings
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get account;

  /// Profile section title for app preferences
  ///
  /// In en, this message translates to:
  /// **'Preferences'**
  String get preferences;

  /// Profile menu item for payment methods
  ///
  /// In en, this message translates to:
  /// **'Payment Methods'**
  String get paymentMethods;

  /// Profile menu item for documents
  ///
  /// In en, this message translates to:
  /// **'My Documents'**
  String get myDocuments;

  /// Profile menu item for saved addresses
  ///
  /// In en, this message translates to:
  /// **'Saved Addresses'**
  String get savedAddresses;

  /// Label for wallet address in profile
  ///
  /// In en, this message translates to:
  /// **'Wallet Address'**
  String get walletAddressLabel;

  /// Text shown when a field has not been configured
  ///
  /// In en, this message translates to:
  /// **'Not Set'**
  String get notSet;

  /// Profile menu item for language settings
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// Profile menu item for help and support
  ///
  /// In en, this message translates to:
  /// **'Help & Support'**
  String get helpSupport;

  /// Profile menu item for about page
  ///
  /// In en, this message translates to:
  /// **'About Truxify'**
  String get aboutTruxify;

  /// Button text to log out of the app
  ///
  /// In en, this message translates to:
  /// **'Logout'**
  String get logout;

  /// Label indicating offline mode with last updated time
  ///
  /// In en, this message translates to:
  /// **'Offline Mode (last updated {timeAgo})'**
  String offlineModeLabel(String timeAgo);

  /// Label for orders count or section in profile
  ///
  /// In en, this message translates to:
  /// **'Orders'**
  String get ordersLabel;

  /// Label for saved items count in profile
  ///
  /// In en, this message translates to:
  /// **'Saved'**
  String get savedLabel;

  /// Label for CO2 emissions saved metric
  ///
  /// In en, this message translates to:
  /// **'CO₂ Saved'**
  String get co2Label;

  /// Button text to edit profile information
  ///
  /// In en, this message translates to:
  /// **'Edit Profile'**
  String get editProfile;

  /// Label for full name input field
  ///
  /// In en, this message translates to:
  /// **'Full Name'**
  String get fullName;

  /// Label for company name input field
  ///
  /// In en, this message translates to:
  /// **'Company Name'**
  String get companyName;

  /// Label for phone number display or input
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get phone;

  /// Placeholder text for full name input
  ///
  /// In en, this message translates to:
  /// **'Enter your full name'**
  String get enterFullName;

  /// Placeholder text for company name input
  ///
  /// In en, this message translates to:
  /// **'Enter your company name'**
  String get enterCompanyName;

  /// Placeholder text for phone number input
  ///
  /// In en, this message translates to:
  /// **'Enter your phone number'**
  String get enterPhoneNumber;

  /// Validation error when name field is empty
  ///
  /// In en, this message translates to:
  /// **'Name is required'**
  String get nameIsRequired;

  /// Validation error when company name field is empty
  ///
  /// In en, this message translates to:
  /// **'Company name is required'**
  String get companyNameIsRequired;

  /// Validation error when phone number field is empty
  ///
  /// In en, this message translates to:
  /// **'Phone number is required'**
  String get phoneNumberIsRequired;

  /// Loading text while profile changes are being saved
  ///
  /// In en, this message translates to:
  /// **'Saving...'**
  String get saving;

  /// Button text to save profile changes
  ///
  /// In en, this message translates to:
  /// **'Save Changes'**
  String get saveChanges;

  /// Success message after profile is updated
  ///
  /// In en, this message translates to:
  /// **'Profile updated successfully'**
  String get profileUpdatedSuccessfully;

  /// Error message when profile data fails to load
  ///
  /// In en, this message translates to:
  /// **'Failed to load profile'**
  String get failedToLoadProfile;

  /// Error message when profile update fails
  ///
  /// In en, this message translates to:
  /// **'Failed to update profile'**
  String get failedToUpdateProfile;

  /// Button text to share order tracking link
  ///
  /// In en, this message translates to:
  /// **'Share Tracking'**
  String get shareTracking;

  /// Success message when tracking link is generated
  ///
  /// In en, this message translates to:
  /// **'Tracking link generated'**
  String get trackingLinkGenerated;

  /// Error message when sharing fails
  ///
  /// In en, this message translates to:
  /// **'Unable to share'**
  String get unableToShare;

  /// Message shown when a tracking link has expired
  ///
  /// In en, this message translates to:
  /// **'This tracking link has expired or is no longer valid.'**
  String get linkExpired;

  /// Message shown when tracking links are revoked
  ///
  /// In en, this message translates to:
  /// **'All tracking links have been revoked.'**
  String get trackingRevoked;

  /// Button text to copy tracking link to clipboard
  ///
  /// In en, this message translates to:
  /// **'Copy Link'**
  String get copyLink;

  /// Default message included when sharing tracking link
  ///
  /// In en, this message translates to:
  /// **'Track your shipment on Truxify'**
  String get shareMessage;

  /// Error message when an order referenced by a notification cannot be found
  ///
  /// In en, this message translates to:
  /// **'Order not found'**
  String get orderNotFound;

  /// Title for notification-related UI elements
  ///
  /// In en, this message translates to:
  /// **'Notification'**
  String get notification;

  /// Error message when a notification cannot be navigated to
  ///
  /// In en, this message translates to:
  /// **'Unable to open notification'**
  String get unableToOpen;

  /// Button text to download the order invoice as PDF
  ///
  /// In en, this message translates to:
  /// **'Download Invoice'**
  String get downloadInvoice;

  /// Status text while the PDF invoice is being generated
  ///
  /// In en, this message translates to:
  /// **'Generating Invoice...'**
  String get generatingInvoice;

  /// Success message after invoice PDF is generated
  ///
  /// In en, this message translates to:
  /// **'Invoice ready'**
  String get invoiceReady;

  /// Button text to share the generated invoice
  ///
  /// In en, this message translates to:
  /// **'Share Invoice'**
  String get shareInvoice;

  /// Button text to print the generated invoice
  ///
  /// In en, this message translates to:
  /// **'Print Invoice'**
  String get printInvoice;

  /// Error message when invoice download or generation fails
  ///
  /// In en, this message translates to:
  /// **'Download failed'**
  String get downloadFailed;

  /// Error message when network connection fails
  ///
  /// In en, this message translates to:
  /// **'Network error. Please check your connection.'**
  String get networkError;

  /// English language name
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get english;

  /// Hindi language name
  ///
  /// In en, this message translates to:
  /// **'Hindi'**
  String get hindi;

  /// Tamil language name
  ///
  /// In en, this message translates to:
  /// **'Tamil'**
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
      <String>['en', 'hi', 'kn', 'mr', 'ta'].contains(locale.languageCode);

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
    case 'kn':
      return AppLocalizationsKn();
    case 'mr':
      return AppLocalizationsMr();
    case 'ta':
      return AppLocalizationsTa();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
