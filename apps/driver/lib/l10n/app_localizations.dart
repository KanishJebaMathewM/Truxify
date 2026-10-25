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

  /// The title of the driver application
  ///
  /// In en, this message translates to:
  /// **'Truxify Driver'**
  String get appTitle;

  /// General loading indicator text
  ///
  /// In en, this message translates to:
  /// **'Loading...'**
  String get loadingText;

  /// Button label to retry a failed action
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get retry;

  /// Generic error title
  ///
  /// In en, this message translates to:
  /// **'Error'**
  String get error;

  /// Button label to cancel an action
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// Button label to save changes
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// Button label to close a dialog or screen
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get close;

  /// Button label to apply a selection or setting
  ///
  /// In en, this message translates to:
  /// **'Apply'**
  String get apply;

  /// Button label to reset filters or form fields
  ///
  /// In en, this message translates to:
  /// **'Reset'**
  String get reset;

  /// Placeholder text for search input fields
  ///
  /// In en, this message translates to:
  /// **'Search'**
  String get search;

  /// Greeting on the login screen
  ///
  /// In en, this message translates to:
  /// **'Welcome, Driver!'**
  String get welcomeDriver;

  /// Subtitle on the login screen encouraging sign-in
  ///
  /// In en, this message translates to:
  /// **'Log in to start earning'**
  String get logInToStartEarning;

  /// Label for the phone number input field
  ///
  /// In en, this message translates to:
  /// **'Phone Number'**
  String get phoneNumber;

  /// Button label to send a one-time password
  ///
  /// In en, this message translates to:
  /// **'Send OTP'**
  String get sendOtp;

  /// Status text while an OTP is being sent
  ///
  /// In en, this message translates to:
  /// **'Sending...'**
  String get sending;

  /// Error message when login verification fails
  ///
  /// In en, this message translates to:
  /// **'Verification failed'**
  String get verificationFailed;

  /// Validation message when phone field is empty
  ///
  /// In en, this message translates to:
  /// **'Please enter your phone number'**
  String get pleaseEnterPhone;

  /// Validation message for invalid phone format
  ///
  /// In en, this message translates to:
  /// **'Please enter a valid phone number'**
  String get enterValidPhone;

  /// Validation message for incorrect phone number length
  ///
  /// In en, this message translates to:
  /// **'Phone number must be exactly {digitCount} digits'**
  String phoneMustBeExactDigits(int digitCount);

  /// Validation message when phone contains non-digit characters
  ///
  /// In en, this message translates to:
  /// **'Phone number must contain only digits'**
  String get phoneMustBeDigits;

  /// Message shown when automatic OTP detection fails
  ///
  /// In en, this message translates to:
  /// **'Auto-verification failed. Please enter OTP manually.'**
  String get autoVerificationFailed;

  /// Message indicating driver-only access
  ///
  /// In en, this message translates to:
  /// **'This area is restricted to registered drivers.'**
  String get protectedDriverAccess;

  /// Title of the OTP verification screen
  ///
  /// In en, this message translates to:
  /// **'Verify OTP'**
  String get verifyOtp;

  /// Instruction text on the OTP screen
  ///
  /// In en, this message translates to:
  /// **'Enter the OTP sent to your phone'**
  String get enterOtp;

  /// Text showing which phone number the OTP was sent to
  ///
  /// In en, this message translates to:
  /// **'Sent to {phoneNumber}'**
  String sentTo(String phoneNumber);

  /// Error message for incorrect OTP entry
  ///
  /// In en, this message translates to:
  /// **'Invalid OTP. Please try again.'**
  String get invalidOtp;

  /// Message when the OTP code has expired
  ///
  /// In en, this message translates to:
  /// **'OTP has expired. Please request a new one.'**
  String get codeExpired;

  /// General verification failure message on OTP screen
  ///
  /// In en, this message translates to:
  /// **'Verification failed. Please try again.'**
  String get verificationFailedMsg;

  /// Error message when OTP verification request fails
  ///
  /// In en, this message translates to:
  /// **'Could not verify OTP. Please try again.'**
  String get couldNotVerifyOtp;

  /// Status text while OTP is being verified
  ///
  /// In en, this message translates to:
  /// **'Verifying...'**
  String get verifying;

  /// Navigation label for the Home tab
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get home;

  /// Navigation label for the Trips tab
  ///
  /// In en, this message translates to:
  /// **'Trips'**
  String get trips;

  /// Navigation label for the Earnings tab
  ///
  /// In en, this message translates to:
  /// **'Earnings'**
  String get earnings;

  /// Navigation label for the Profile tab
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profile;

  /// Banner text when app is in offline mode
  ///
  /// In en, this message translates to:
  /// **'You are offline. Using cached data.'**
  String get offlineUsingCachedData;

  /// Notification text when a new load appears
  ///
  /// In en, this message translates to:
  /// **'New load available!'**
  String get newLoadAvailable;

  /// Button label to view details
  ///
  /// In en, this message translates to:
  /// **'View'**
  String get view;

  /// Status text when GPS navigation is active
  ///
  /// In en, this message translates to:
  /// **'Navigation active'**
  String get navigationActive;

  /// Text showing the current trip destination
  ///
  /// In en, this message translates to:
  /// **'Heading to {destination}'**
  String headingTo(String destination);

  /// Status text while GPS is determining position
  ///
  /// In en, this message translates to:
  /// **'Locating you...'**
  String get locating;

  /// Error text when GPS cannot determine position
  ///
  /// In en, this message translates to:
  /// **'Location unavailable'**
  String get locationUnavailable;

  /// Label for the driver's current GPS location
  ///
  /// In en, this message translates to:
  /// **'Current Location'**
  String get currentLocation;

  /// Instruction text to pull-to-refresh
  ///
  /// In en, this message translates to:
  /// **'Tap to refresh'**
  String get tapToRefresh;

  /// Status text while location is being fetched
  ///
  /// In en, this message translates to:
  /// **'Fetching your location...'**
  String get fetchingLocation;

  /// Prompt for destination input
  ///
  /// In en, this message translates to:
  /// **'Where are you heading?'**
  String get whereAreYouHeading;

  /// Status text when driver is online and available
  ///
  /// In en, this message translates to:
  /// **'Online & Ready'**
  String get onlineAndReady;

  /// Status text when driver is offline
  ///
  /// In en, this message translates to:
  /// **'Offline'**
  String get offline;

  /// Message encouraging driver to go online
  ///
  /// In en, this message translates to:
  /// **'You are offline. Go online to receive loads.'**
  String get offlineGoOnline;

  /// Status text while radar is scanning for loads
  ///
  /// In en, this message translates to:
  /// **'Radar active — fetching nearby loads...'**
  String get radarActiveFetching;

  /// Status text when radar is actively searching
  ///
  /// In en, this message translates to:
  /// **'Radar active — looking for loads near you.'**
  String get radarActiveLooking;

  /// Label for today's earnings display
  ///
  /// In en, this message translates to:
  /// **'Today\'s Pay'**
  String get todayPay;

  /// Label for hours worked display
  ///
  /// In en, this message translates to:
  /// **'Shift Hours'**
  String get shiftHours;

  /// Label for driver rating display
  ///
  /// In en, this message translates to:
  /// **'Rating'**
  String get rating;

  /// Text when dashboard metrics cannot be loaded
  ///
  /// In en, this message translates to:
  /// **'Metrics unavailable'**
  String get metricsUnavailable;

  /// Text when no destination has been entered
  ///
  /// In en, this message translates to:
  /// **'No destination set'**
  String get noDestinationAvailable;

  /// Error text when current GPS location is unavailable
  ///
  /// In en, this message translates to:
  /// **'Current location unavailable'**
  String get currentLocationUnavailable;

  /// Error message when Google Maps launch fails
  ///
  /// In en, this message translates to:
  /// **'Unable to open Google Maps'**
  String get unableToOpenGoogleMaps;

  /// Error message when route generation fails
  ///
  /// In en, this message translates to:
  /// **'Failed to generate route'**
  String get failedToGenerateRoute;

  /// Status label when driver is en route to destination
  ///
  /// In en, this message translates to:
  /// **'En Route'**
  String get enRoute;

  /// Label for the currently assigned load
  ///
  /// In en, this message translates to:
  /// **'Assigned Load'**
  String get assignedLoad;

  /// Label for trip distance
  ///
  /// In en, this message translates to:
  /// **'Distance'**
  String get distance;

  /// Label for estimated trip duration
  ///
  /// In en, this message translates to:
  /// **'Est. Duration'**
  String get estDuration;

  /// Label for estimated trip payout
  ///
  /// In en, this message translates to:
  /// **'Est. Payout'**
  String get estPayout;

  /// Instruction on the slide-to-confirm button to complete
  ///
  /// In en, this message translates to:
  /// **'Slide to complete trip'**
  String get slideToCompleteTrip;

  /// Instruction on the slide-to-confirm button to start
  ///
  /// In en, this message translates to:
  /// **'Slide to start trip'**
  String get slideToStartTrip;

  /// Button label to cancel a trip assignment
  ///
  /// In en, this message translates to:
  /// **'Cancel Assignment'**
  String get cancelAssignment;

  /// Success message after trip completion with earnings
  ///
  /// In en, this message translates to:
  /// **'Trip completed! Net earnings: {amount}'**
  String tripCompletedNetEarnings(String amount);

  /// Error message when trip completion fails
  ///
  /// In en, this message translates to:
  /// **'Failed to complete trip'**
  String get failedToCompleteTrip;

  /// Error message when trip start fails
  ///
  /// In en, this message translates to:
  /// **'Failed to start trip'**
  String get failedToStartTrip;

  /// Title or status for a completed trip
  ///
  /// In en, this message translates to:
  /// **'Trip Completed'**
  String get tripCompleted;

  /// Prompt asking the driver to go online before proceeding
  ///
  /// In en, this message translates to:
  /// **'Please go online first'**
  String get pleaseGoOnline;

  /// Message when no destination is set for navigation
  ///
  /// In en, this message translates to:
  /// **'No destination available. Please set a destination.'**
  String get noDestinationAvailable2;

  /// Error message when location permission has not been granted
  ///
  /// In en, this message translates to:
  /// **'Location permission is required'**
  String get locationPermissionRequired;

  /// Error message when location access is denied by user
  ///
  /// In en, this message translates to:
  /// **'Location access denied'**
  String get locationAccessDenied;

  /// Error message when location permission is permanently denied
  ///
  /// In en, this message translates to:
  /// **'Location permission permanently denied. Please enable in settings.'**
  String get locationPermDenied;

  /// Button label to open device settings
  ///
  /// In en, this message translates to:
  /// **'Open Settings'**
  String get openSettings;

  /// Title or button label to edit the driver profile
  ///
  /// In en, this message translates to:
  /// **'Edit Profile'**
  String get editProfile;

  /// Label for the full name input field
  ///
  /// In en, this message translates to:
  /// **'Full Names'**
  String get fullNames;

  /// Label for the phone number display
  ///
  /// In en, this message translates to:
  /// **'Phone Number'**
  String get phoneNumbers;

  /// Label for the email address input field
  ///
  /// In en, this message translates to:
  /// **'Email Address'**
  String get emailAddress;

  /// Label for the vehicle registration input field
  ///
  /// In en, this message translates to:
  /// **'Vehicle Registration Number'**
  String get vehicleRegistrationNumber;

  /// Button label to save profile changes
  ///
  /// In en, this message translates to:
  /// **'Save Changes'**
  String get saveChanges;

  /// Success message after profile update
  ///
  /// In en, this message translates to:
  /// **'Profile updated successfully'**
  String get profileUpdatedSuccessfully;

  /// Title or label for language selection
  ///
  /// In en, this message translates to:
  /// **'Select Language'**
  String get selectLanguage;

  /// Button label to confirm language change
  ///
  /// In en, this message translates to:
  /// **'Apply Language'**
  String get applyLanguage;

  /// Success message after language change
  ///
  /// In en, this message translates to:
  /// **'Language switched successfully'**
  String get languageSwitched;

  /// Label for the Polygon wallet address field
  ///
  /// In en, this message translates to:
  /// **'Polygon Wallet Address'**
  String get polygonWalletAddress;

  /// Button label to save the wallet address
  ///
  /// In en, this message translates to:
  /// **'Save Wallet Address'**
  String get saveWalletAddress;

  /// Success message after wallet address update
  ///
  /// In en, this message translates to:
  /// **'Wallet address updated'**
  String get walletAddressUpdated;

  /// Error message when wallet address update fails
  ///
  /// In en, this message translates to:
  /// **'Failed to update wallet address'**
  String get failedToUpdateWallet;

  /// Section title for help and support
  ///
  /// In en, this message translates to:
  /// **'Help & Support'**
  String get helpSupport;

  /// Button label to view frequently asked questions
  ///
  /// In en, this message translates to:
  /// **'Browse FAQs'**
  String get browseFAQs;

  /// Subtitle describing the FAQ section
  ///
  /// In en, this message translates to:
  /// **'Get instant answers to common questions'**
  String get instantAnswers;

  /// Section title for app about information
  ///
  /// In en, this message translates to:
  /// **'About Truxify Driver App'**
  String get aboutTruxifyDriverApp;

  /// Description of the Truxify application
  ///
  /// In en, this message translates to:
  /// **'Truxify is a truck logistics platform connecting drivers with loads across East Africa.'**
  String get truxifyDescription;

  /// Section title for driver documents
  ///
  /// In en, this message translates to:
  /// **'Documents'**
  String get documents;

  /// Label for driver license and permit document section
  ///
  /// In en, this message translates to:
  /// **'Driver License & Permit Papers'**
  String get driverLicensePermitPapers;

  /// Section title for notifications settings
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notifications;

  /// Label for trip notification alerts toggle
  ///
  /// In en, this message translates to:
  /// **'View Trip Alerts'**
  String get viewTripAlerts;

  /// Label for wallet address display
  ///
  /// In en, this message translates to:
  /// **'Wallet Address'**
  String get walletAddress;

  /// Placeholder text when a value has not been set
  ///
  /// In en, this message translates to:
  /// **'Not set'**
  String get notSet;

  /// Label for the current language setting
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get languageLabel;

  /// Label indicating round-the-clock support availability
  ///
  /// In en, this message translates to:
  /// **'Help & Support (24/7)'**
  String get helpAndSupport247;

  /// Label for app version information section
  ///
  /// In en, this message translates to:
  /// **'Version & App Info'**
  String get versionAndAppInfo;

  /// Button label to log out of the application
  ///
  /// In en, this message translates to:
  /// **'Logout'**
  String get logout;

  /// Error message when logout fails
  ///
  /// In en, this message translates to:
  /// **'Logout failed. Please try again.'**
  String get logoutFailed;

  /// Title of the trips screen
  ///
  /// In en, this message translates to:
  /// **'My Trips'**
  String get myTrips;

  /// Title or tab for the load marketplace
  ///
  /// In en, this message translates to:
  /// **'Marketplace'**
  String get marketplace;

  /// Label for the trip sorting option
  ///
  /// In en, this message translates to:
  /// **'Sort Trips'**
  String get sortTrips;

  /// Sort option to show newest trips first
  ///
  /// In en, this message translates to:
  /// **'Newest First'**
  String get newestFirst;

  /// Sort option to show oldest trips first
  ///
  /// In en, this message translates to:
  /// **'Oldest First'**
  String get oldestFirst;

  /// Sort option to show highest-earning trips first
  ///
  /// In en, this message translates to:
  /// **'Highest Earnings'**
  String get highestEarnings;

  /// Sort option to show lowest-earning trips first
  ///
  /// In en, this message translates to:
  /// **'Lowest Earnings'**
  String get lowestEarnings;

  /// Sort or filter option to group trips by status
  ///
  /// In en, this message translates to:
  /// **'By Status'**
  String get byStatus;

  /// Label for total number of trips
  ///
  /// In en, this message translates to:
  /// **'Total Trips'**
  String get totalTrips;

  /// Label for total earnings amount
  ///
  /// In en, this message translates to:
  /// **'Total Earned'**
  String get totalEarned;

  /// Label for trip completion percentage
  ///
  /// In en, this message translates to:
  /// **'Completion'**
  String get completion;

  /// Filter option to show all trips
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get all;

  /// Filter option to show active trips
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get active2;

  /// Filter option to show completed trips
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get completed2;

  /// Filter option to show cancelled trips
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get cancelled2;

  /// Error message when trips list fails to load
  ///
  /// In en, this message translates to:
  /// **'Failed to load trips'**
  String get failedToLoadTrips;

  /// Instruction text for pull-to-refresh gesture
  ///
  /// In en, this message translates to:
  /// **'Pull down to retry'**
  String get pullDownToRetry;

  /// Empty state text when no trips match filters
  ///
  /// In en, this message translates to:
  /// **'No trips found'**
  String get noTripsFound;

  /// Label for the number of delivery stops on a trip
  ///
  /// In en, this message translates to:
  /// **'Delivery Stops'**
  String get deliveryStops;

  /// Button label to mark the current delivery stop as done
  ///
  /// In en, this message translates to:
  /// **'Mark Current Stop Completed'**
  String get markCurrentStopCompleted;

  /// Status badge text for an active trip
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get activeStatus;

  /// Status badge text for a completed trip
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get completedStatus;

  /// Status badge text for a cancelled trip
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get cancelledStatus;

  /// Section title for loads available along current route
  ///
  /// In en, this message translates to:
  /// **'En Route Opportunities'**
  String get enRouteOpportunities;

  /// Label for nearby load pickup section
  ///
  /// In en, this message translates to:
  /// **'Pickup Nearby Loads'**
  String get pickupNearbyLoads;

  /// Section title for marketplace load listings
  ///
  /// In en, this message translates to:
  /// **'Marketplace Loads'**
  String get marketplaceLoads;

  /// Subtitle describing available marketplace loads
  ///
  /// In en, this message translates to:
  /// **'Available loads you can bid for'**
  String get availableLoadsYouCanBidFor;

  /// Error message when marketplace data fails to load
  ///
  /// In en, this message translates to:
  /// **'Could not load marketplace'**
  String get couldNotLoadMarketplace;

  /// Instruction text to refresh marketplace data
  ///
  /// In en, this message translates to:
  /// **'Pull to refresh'**
  String get pullToRefresh;

  /// Empty state text when no loads are available
  ///
  /// In en, this message translates to:
  /// **'No loads available'**
  String get noLoadsAvailable;

  /// Success message after submitting a bid
  ///
  /// In en, this message translates to:
  /// **'Bid submitted successfully'**
  String get bidSubmitted;

  /// Error message when bid submission fails
  ///
  /// In en, this message translates to:
  /// **'Failed to submit bid'**
  String get failedToSubmitBid;

  /// Error message when a load record has no valid identifier
  ///
  /// In en, this message translates to:
  /// **'This load is missing an ID'**
  String get thisLoadIsMissingId;

  /// Section title for ML-powered return load recommendations
  ///
  /// In en, this message translates to:
  /// **'Recommended Return Loads'**
  String get recommendedReturnLoads;

  /// Label shown when a recommendation has no route
  ///
  /// In en, this message translates to:
  /// **'Recommended For You'**
  String get recommendedForYou;

  /// Label for ML match score percentage
  ///
  /// In en, this message translates to:
  /// **'Match Score'**
  String get matchScore;

  /// Label for the top recommendation
  ///
  /// In en, this message translates to:
  /// **'Best Match'**
  String get bestMatch;

  /// Empty state when ML returns no recommendations
  ///
  /// In en, this message translates to:
  /// **'No return load recommendations available'**
  String get noRecommendations;

  /// Error state when ML endpoint fails
  ///
  /// In en, this message translates to:
  /// **'Could not load recommendations'**
  String get couldNotLoadRecommendations;

  /// Hint shown when driver has no active trip for recommendations
  ///
  /// In en, this message translates to:
  /// **'Complete a trip to see return load suggestions'**
  String get noActiveTripForRecommendations;

  /// Label for detour distance
  ///
  /// In en, this message translates to:
  /// **'Detour'**
  String get detourDistance;

  /// Button label to place a bid on a load
  ///
  /// In en, this message translates to:
  /// **'Bid'**
  String get bidOnLoad;

  /// Button label to update an existing bid
  ///
  /// In en, this message translates to:
  /// **'Update Bid'**
  String get updateBid;

  /// Title of the bid placement bottom sheet
  ///
  /// In en, this message translates to:
  /// **'Place Your Bid'**
  String get placeYourBid;

  /// Label for the bid amount input field
  ///
  /// In en, this message translates to:
  /// **'Bid Amount'**
  String get bidAmount;

  /// Button label to submit a bid
  ///
  /// In en, this message translates to:
  /// **'Submit Bid'**
  String get submitBid;

  /// Validation message for invalid bid input
  ///
  /// In en, this message translates to:
  /// **'Enter a valid bid amount'**
  String get enterValidBid;

  /// Error message when a notification cannot be navigated to
  ///
  /// In en, this message translates to:
  /// **'Unable to open notification'**
  String get unableToOpen;

  /// Button label to withdraw funds from wallet
  ///
  /// In en, this message translates to:
  /// **'Withdraw'**
  String get withdraw;

  /// Title of the withdrawal bottom sheet
  ///
  /// In en, this message translates to:
  /// **'Withdraw Funds'**
  String get withdrawFunds;

  /// Label for the confirmed wallet balance in the withdrawal sheet
  ///
  /// In en, this message translates to:
  /// **'Available Balance'**
  String get availableBalance;

  /// Label for the amount input field in the withdrawal sheet
  ///
  /// In en, this message translates to:
  /// **'Enter Amount'**
  String get enterAmount;

  /// Validation error when amount field is empty
  ///
  /// In en, this message translates to:
  /// **'Amount is required'**
  String get amountRequired;

  /// Validation error when amount is not a valid number
  ///
  /// In en, this message translates to:
  /// **'Please enter a valid amount'**
  String get enterValidAmount;

  /// Validation error when amount is zero or negative
  ///
  /// In en, this message translates to:
  /// **'Amount must be greater than zero'**
  String get amountMustBePositive;

  /// Validation error when amount exceeds confirmed balance
  ///
  /// In en, this message translates to:
  /// **'Insufficient balance'**
  String get insufficientBalance;

  /// Label for the quick-fill button that sets the maximum withdrawal amount
  ///
  /// In en, this message translates to:
  /// **'Max'**
  String get max;

  /// Success message after a successful withdrawal
  ///
  /// In en, this message translates to:
  /// **'Withdrawal successful'**
  String get withdrawalSuccessful;

  /// Error message when network connection fails
  ///
  /// In en, this message translates to:
  /// **'Network error. Please check your connection.'**
  String get networkError;

  /// Label for the theme selection setting
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get theme;

  /// System theme option label
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get system;

  /// Light theme option label
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get light;

  /// Dark theme option label
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get dark;

  /// Snackbar message shown when the OTP is resent to the driver's phone.
  ///
  /// In en, this message translates to:
  /// **'OTP resent successfully'**
  String get otpResent;

  /// Countdown label shown while the resend cooldown timer is running.
  ///
  /// In en, this message translates to:
  /// **'Resend in {seconds}s'**
  String resendOtpIn(int seconds);

  /// Label for the button that resends the OTP to the driver's phone.
  ///
  /// In en, this message translates to:
  /// **'Resend OTP'**
  String get resendOtp;

  /// Language selection setting
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

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
