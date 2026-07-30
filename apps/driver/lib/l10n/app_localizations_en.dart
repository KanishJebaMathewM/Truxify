// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Truxify Driver';

  @override
  String get loadingText => 'Loading...';

  @override
  String get retry => 'Retry';

  @override
  String get error => 'Error';

  @override
  String get cancel => 'Cancel';

  @override
  String get save => 'Save';

  @override
  String get close => 'Close';

  @override
  String get apply => 'Apply';

  @override
  String get reset => 'Reset';

  @override
  String get search => 'Search';

  @override
  String get welcomeDriver => 'Welcome, Driver!';

  @override
  String get logInToStartEarning => 'Log in to start earning';

  @override
  String get phoneNumber => 'Phone Number';

  @override
  String get sendOtp => 'Send OTP';

  @override
  String get sending => 'Sending...';

  @override
  String get verificationFailed => 'Verification failed';

  @override
  String get pleaseEnterPhone => 'Please enter your phone number';

  @override
  String get enterValidPhone => 'Please enter a valid phone number';

  @override
  String phoneMustBeExactDigits(int digitCount) {
    return 'Phone number must be exactly $digitCount digits';
  }

  @override
  String get phoneMustBeDigits => 'Phone number must contain only digits';

  @override
  String get autoVerificationFailed => 'Auto-verification failed. Please enter OTP manually.';

  @override
  String get protectedDriverAccess => 'This area is restricted to registered drivers.';

  @override
  String get verifyOtp => 'Verify OTP';

  @override
  String get enterOtp => 'Enter the OTP sent to your phone';

  @override
  String sentTo(String phoneNumber) {
    return 'Sent to $phoneNumber';
  }

  @override
  String get invalidOtp => 'Invalid OTP. Please try again.';

  @override
  String get codeExpired => 'OTP has expired. Please request a new one.';

  @override
  String get verificationFailedMsg => 'Verification failed. Please try again.';

  @override
  String get couldNotVerifyOtp => 'Could not verify OTP. Please try again.';

  @override
  String get verifying => 'Verifying...';

  @override
  String get home => 'Home';

  @override
  String get trips => 'Trips';

  @override
  String get earnings => 'Earnings';

  @override
  String get profile => 'Profile';

  @override
  String get offlineUsingCachedData => 'You are offline. Using cached data.';

  @override
  String get newLoadAvailable => 'New load available!';

  @override
  String get view => 'View';

  @override
  String get navigationActive => 'Navigation active';

  @override
  String headingTo(String destination) {
    return 'Heading to $destination';
  }

  @override
  String get locating => 'Locating you...';

  @override
  String get locationUnavailable => 'Location unavailable';

  @override
  String get currentLocation => 'Current Location';

  @override
  String get tapToRefresh => 'Tap to refresh';

  @override
  String get fetchingLocation => 'Fetching your location...';

  @override
  String get whereAreYouHeading => 'Where are you heading?';

  @override
  String get onlineAndReady => 'Online & Ready';

  @override
  String get offline => 'Offline';

  @override
  String get offlineGoOnline => 'You are offline. Go online to receive loads.';

  @override
  String get radarActiveFetching => 'Radar active — fetching nearby loads...';

  @override
  String get radarActiveLooking => 'Radar active — looking for loads near you.';

  @override
  String get todayPay => "Today's Pay";

  @override
  String get shiftHours => 'Shift Hours';

  @override
  String get rating => 'Rating';

  @override
  String get metricsUnavailable => 'Metrics unavailable';

  @override
  String get noDestinationAvailable => 'No destination set';

  @override
  String get currentLocationUnavailable => 'Current location unavailable';

  @override
  String get unableToOpenGoogleMaps => 'Unable to open Google Maps';

  @override
  String get failedToGenerateRoute => 'Failed to generate route';

  @override
  String get enRoute => 'En Route';

  @override
  String get assignedLoad => 'Assigned Load';

  @override
  String get distance => 'Distance';

  @override
  String get estDuration => 'Est. Duration';

  @override
  String get estPayout => 'Est. Payout';

  @override
  String get slideToCompleteTrip => 'Slide to complete trip';

  @override
  String get slideToStartTrip => 'Slide to start trip';

  @override
  String get cancelAssignment => 'Cancel Assignment';

  @override
  String tripCompletedNetEarnings(String amount) {
    return 'Trip completed! Net earnings: $amount';
  }

  @override
  String get failedToCompleteTrip => 'Failed to complete trip';

  @override
  String get failedToStartTrip => 'Failed to start trip';

  @override
  String get tripCompleted => 'Trip Completed';

  @override
  String get pleaseGoOnline => 'Please go online first';

  @override
  String get noDestinationAvailable2 => 'No destination available. Please set a destination.';

  @override
  String get locationPermissionRequired => 'Location permission is required';

  @override
  String get locationAccessDenied => 'Location access denied';

  @override
  String get locationPermDenied => 'Location permission permanently denied. Please enable in settings.';

  @override
  String get openSettings => 'Open Settings';

  @override
  String get editProfile => 'Edit Profile';

  @override
  String get fullNames => 'Full Names';

  @override
  String get phoneNumbers => 'Phone Number';

  @override
  String get emailAddress => 'Email Address';

  @override
  String get vehicleRegistrationNumber => 'Vehicle Registration Number';

  @override
  String get saveChanges => 'Save Changes';

  @override
  String get profileUpdatedSuccessfully => 'Profile updated successfully';

  @override
  String get selectLanguage => 'Select Language';

  @override
  String get applyLanguage => 'Apply Language';

  @override
  String get languageSwitched => 'Language switched successfully';

  @override
  String get polygonWalletAddress => 'Polygon Wallet Address';

  @override
  String get saveWalletAddress => 'Save Wallet Address';

  @override
  String get walletAddressUpdated => 'Wallet address updated';

  @override
  String get failedToUpdateWallet => 'Failed to update wallet address';

  @override
  String get helpSupport => 'Help & Support';

  @override
  String get browseFAQs => 'Browse FAQs';

  @override
  String get instantAnswers => 'Get instant answers to common questions';

  @override
  String get aboutTruxifyDriverApp => 'About Truxify Driver App';

  @override
  String get truxifyDescription => 'Truxify is a truck logistics platform connecting drivers with loads across East Africa.';

  @override
  String get documents => 'Documents';

  @override
  String get driverLicensePermitPapers => 'Driver License & Permit Papers';

  @override
  String get notifications => 'Notifications';

  @override
  String get viewTripAlerts => 'View Trip Alerts';

  @override
  String get walletAddress => 'Wallet Address';

  @override
  String get notSet => 'Not set';

  @override
  String get languageLabel => 'Language';

  @override
  String get helpAndSupport247 => 'Help & Support (24/7)';

  @override
  String get versionAndAppInfo => 'Version & App Info';

  @override
  String get logout => 'Logout';

  @override
  String get logoutFailed => 'Logout failed. Please try again.';

  @override
  String get myTrips => 'My Trips';

  @override
  String get marketplace => 'Marketplace';

  @override
  String get sortTrips => 'Sort Trips';

  @override
  String get newestFirst => 'Newest First';

  @override
  String get oldestFirst => 'Oldest First';

  @override
  String get highestEarnings => 'Highest Earnings';

  @override
  String get lowestEarnings => 'Lowest Earnings';

  @override
  String get byStatus => 'By Status';

  @override
  String get totalTrips => 'Total Trips';

  @override
  String get totalEarned => 'Total Earned';

  @override
  String get completion => 'Completion';

  @override
  String get all => 'All';

  @override
  String get active2 => 'Active';

  @override
  String get completed2 => 'Completed';

  @override
  String get cancelled2 => 'Cancelled';

  @override
  String get failedToLoadTrips => 'Failed to load trips';

  @override
  String get pullDownToRetry => 'Pull down to retry';

  @override
  String get noTripsFound => 'No trips found';

  @override
  String get deliveryStops => 'Delivery Stops';

  @override
  String get markCurrentStopCompleted => 'Mark Current Stop Completed';

  @override
  String get activeStatus => 'Active';

  @override
  String get completedStatus => 'Completed';

  @override
  String get cancelledStatus => 'Cancelled';

  @override
  String get enRouteOpportunities => 'En Route Opportunities';

  @override
  String get pickupNearbyLoads => 'Pickup Nearby Loads';

  @override
  String get marketplaceLoads => 'Marketplace Loads';

  @override
  String get availableLoadsYouCanBidFor => 'Available loads you can bid for';

  @override
  String get couldNotLoadMarketplace => 'Could not load marketplace';

  @override
  String get pullToRefresh => 'Pull to refresh';

  @override
  String get noLoadsAvailable => 'No loads available';

  @override
  String get bidSubmitted => 'Bid submitted successfully';

  @override
  String get failedToSubmitBid => 'Failed to submit bid';

  @override
  String get thisLoadIsMissingId => 'This load is missing an ID';

  @override
  String get recommendedReturnLoads => 'Recommended Return Loads';

  @override
  String get recommendedForYou => 'Recommended For You';

  @override
  String get matchScore => 'Match Score';

  @override
  String get bestMatch => 'Best Match';

  @override
  String get noRecommendations => 'No return load recommendations available';

  @override
  String get couldNotLoadRecommendations => 'Could not load recommendations';

  @override
  String get noActiveTripForRecommendations => 'Complete a trip to see return load suggestions';

  @override
  String get detourDistance => 'Detour';

  @override
  String get bidOnLoad => 'Bid';

  @override
  String get updateBid => 'Update Bid';

  @override
  String get placeYourBid => 'Place Your Bid';

  @override
  String get bidAmount => 'Bid Amount';

  @override
  String get submitBid => 'Submit Bid';

  @override
  String get enterValidBid => 'Enter a valid bid amount';
  String get unableToOpen => 'Unable to open notification';
  String get withdraw => 'Withdraw';

  @override
  String get withdrawFunds => 'Withdraw Funds';

  @override
  String get availableBalance => 'Available Balance';

  @override
  String get enterAmount => 'Enter Amount';

  @override
  String get amountRequired => 'Amount is required';

  @override
  String get enterValidAmount => 'Please enter a valid amount';

  @override
  String get amountMustBePositive => 'Amount must be greater than zero';

  @override
  String get insufficientBalance => 'Insufficient balance';

  @override
  String get max => 'Max';

  @override
  String get withdrawalSuccessful => 'Withdrawal successful';
}
