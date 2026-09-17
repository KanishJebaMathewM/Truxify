// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Kannada (`kn`).
class AppLocalizationsKn extends AppLocalizations {
  AppLocalizationsKn([String locale = 'kn']) : super(locale);

  @override
  String get appTitle => 'Truxify ಚಾಲಕ';

  @override
  String get loadingText => 'ಲೋಡ್ ಆಗುತ್ತಿದೆ...';

  @override
  String get retry => 'ಮರುಪ್ರಯತ್ನಿಸಿ';

  @override
  String get error => 'ದೋಷ';

  @override
  String get cancel => 'ರದ್ದುಮಾಡಿ';

  @override
  String get save => 'ಉಳಿಸಿ';

  @override
  String get close => 'ಮುಚ್ಚಿ';

  @override
  String get apply => 'ಅನ್ವಯಿಸಿ';

  @override
  String get reset => 'ಮರುಹೊಂದಿಸಿ';

  @override
  String get search => 'ಹುಡುಕಿ';

  @override
  String get welcomeDriver => 'ಸ್ವಾಗತ, ಚಾಲಕ!';

  @override
  String get logInToStartEarning => 'ಹಣ ಸಂಪಾದಿಸಲು ಲಾಗ್ ಇನ್ ಮಾಡಿ';

  @override
  String get phoneNumber => 'ಫೋನ್ ಸಂಖ್ಯೆ';

  @override
  String get sendOtp => 'OTP ಕಳುಹಿಸಿ';

  @override
  String get sending => 'ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ...';

  @override
  String get verificationFailed => 'ಪರಿಶೀಲನೆ ವಿಫಲವಾಗಿದೆ';

  @override
  String get pleaseEnterPhone => 'ದಯವಿಟ್ಟು ನಿಮ್ಮ ಫೋನ್ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ';

  @override
  String get enterValidPhone => 'ದಯವಿಟ್ಟು ಮಾನ್ಯ ಫೋನ್ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ';

  @override
  String phoneMustBeExactDigits(int digitCount) {
    return 'ಫೋನ್ ಸಂಖ್ಯೆಯು ನಿಖರವಾಗಿ $digitCount ಅಂಕಿಗಳನ್ನು ಹೊಂದಿರಬೇಕು';
  }

  @override
  String get phoneMustBeDigits => 'ಫೋನ್ ಸಂಖ್ಯೆಯು ಕೇವಲ ಅಂಕಿಗಳನ್ನು ಮಾತ್ರ ಹೊಂದಿರಬೇಕು';

  @override
  String get autoVerificationFailed => 'ಸ್ವಯಂ-ಪರಿಶೀಲನೆ ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು OTP ಅನ್ನು ಹಸ್ತಚಾಲಿತವಾಗಿ ನಮೂದಿಸಿ.';

  @override
  String get protectedDriverAccess => 'ಈ ಪ್ರದೇಶವು ನೋಂದಾಯಿತ ಚಾಲಕರಿಗೆ ಮಾತ್ರ ಸೀಮಿತವಾಗಿದೆ.';

  @override
  String get verifyOtp => 'OTP ಪರಿಶೀಲಿಸಿ';

  @override
  String get enterOtp => 'ನಿಮ್ಮ ಫೋನ್‌ಗೆ ಕಳುಹಿಸಲಾದ OTP ಅನ್ನು ನಮೂದಿಸಿ';

  @override
  String sentTo(String phoneNumber) {
    return '$phoneNumber ಗೆ ಕಳುಹಿಸಲಾಗಿದೆ';
  }

  @override
  String get invalidOtp => 'ಅಮಾನ್ಯ OTP. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';

  @override
  String get codeExpired => 'OTP ಅವಧಿ ಮುಗಿದಿದೆ. ದಯವಿಟ್ಟು ಹೊಸದನ್ನು ವಿನಂತಿಸಿ.';

  @override
  String get verificationFailedMsg => 'ಪರಿಶೀಲನೆ ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';

  @override
  String get couldNotVerifyOtp => 'OTP ಪರಿಶೀಲಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';

  @override
  String get verifying => 'ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ...';

  @override
  String get home => 'ಮನೆ';

  @override
  String get trips => 'ಪ್ರಯಾಣಗಳು';

  @override
  String get earnings => 'ಸಂಪಾದನೆ';

  @override
  String get profile => 'ಪ್ರೊಫೈಲ್';

  @override
  String get offlineUsingCachedData => 'ನೀವು ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿದ್ದೀರಿ. ಕ್ಯಾಶ್ ಮಾಡಿದ ಡೇಟಾವನ್ನು ಬಳಸುತ್ತಿದೆ.';

  @override
  String get newLoadAvailable => 'ಹೊಸ ಲೋಡ್ ಲಭ್ಯವಿದೆ!';

  @override
  String get view => 'ನೋಡಿ';

  @override
  String get navigationActive => 'ನಾವಿಗೇಶನ್ ಸಕ್ರಿಯ';

  @override
  String headingTo(String destination) {
    return '$destination ಗೆ ಹೋಗುತ್ತಿದೆ';
  }

  @override
  String get locating => 'ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಪತ್ತೆಹಚ್ಚಲಾಗುತ್ತಿದೆ...';

  @override
  String get locationUnavailable => 'ಸ್ಥಳ ಲಭ್ಯವಿಲ್ಲ';

  @override
  String get currentLocation => 'ಪ್ರಸ್ತುತ ಸ್ಥಳ';

  @override
  String get tapToRefresh => 'ರಿಫ್ರೆಶ್ ಮಾಡಲು ಟ್ಯಾಪ್ ಮಾಡಿ';

  @override
  String get fetchingLocation => 'ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಪಡೆಯಲಾಗುತ್ತಿದೆ...';

  @override
  String get whereAreYouHeading => 'ನೀವು ಎಲ್ಲಿಗೆ ಹೋಗುತ್ತಿದ್ದೀರಿ?';

  @override
  String get onlineAndReady => 'ಆನ್‌ಲೈನ್ ಮತ್ತು ಸಿದ್ಧ';

  @override
  String get offline => 'ಆಫ್‌ಲೈನ್';

  @override
  String get offlineGoOnline => 'ನೀವು ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿದ್ದೀರಿ. ಲೋಡ್‌ಗಳನ್ನು ಸ್ವೀಕರಿಸಲು ಆನ್‌ಲೈನ್‌ಗೆ ಹೋಗಿ.';

  @override
  String get radarActiveFetching => 'ರಾಡಾರ್ ಸಕ್ರಿಯ — ಹತ್ತಿರದ ಲೋಡ್‌ಗಳನ್ನು ಪಡೆಯಲಾಗುತ್ತಿದೆ...';

  @override
  String get radarActiveLooking => 'ರಾಡಾರ್ ಸಕ್ರಿಯ — ನಿಮ್ಮ ಹತ್ತಿರ ಲೋಡ್‌ಗಳನ್ನು ಹುಡುಕಲಾಗುತ್ತಿದೆ.';

  @override
  String get todayPay => 'ಇಂದಿನ ವೇತನ';

  @override
  String get shiftHours => 'ಶಿಫ್ಟ್ ಗಂಟೆಗಳು';

  @override
  String get rating => 'ರೇಟಿಂಗ್';

  @override
  String get metricsUnavailable => 'ಮೆಟ್ರಿಕ್ಸ್ ಲಭ್ಯವಿಲ್ಲ';

  @override
  String get noDestinationAvailable => 'ಯಾವುದೇ ಗಮ್ಯಸ್ಥಾನ ಹೊಂದಿಸಲಾಗಿಲ್ಲ';

  @override
  String get currentLocationUnavailable => 'ಪ್ರಸ್ತುತ ಸ್ಥಳ ಲಭ್ಯವಿಲ್ಲ';

  @override
  String get unableToOpenGoogleMaps => 'Google Maps ತೆರೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ';

  @override
  String get failedToGenerateRoute => 'ಮಾರ್ಗವನ್ನು ರಚಿಸಲು ವಿಫಲವಾಗಿದೆ';

  @override
  String get enRoute => 'ಮಾರ್ಗದಲ್ಲಿ';

  @override
  String get assignedLoad => 'ನಿಯೋಜಿತ ಲೋಡ್';

  @override
  String get distance => 'ದೂರ';

  @override
  String get estDuration => 'ಅಂದಾಜು ಅವಧಿ';

  @override
  String get estPayout => 'ಅಂದಾಜು ಪಾವತಿ';

  @override
  String get slideToCompleteTrip => 'ಪ್ರಯಾಣ ಪೂರ್ಣಗೊಳಿಸಲು ಸ್ಲೈಡ್ ಮಾಡಿ';

  @override
  String get slideToStartTrip => 'ಪ್ರಯಾಣ ಪ್ರಾರಂಭಿಸಲು ಸ್ಲೈಡ್ ಮಾಡಿ';

  @override
  String get cancelAssignment => 'ನಿಯೋಜನೆ ರದ್ದುಮಾಡಿ';

  @override
  String tripCompletedNetEarnings(String amount) {
    return 'ಪ್ರಯಾಣ ಪೂರ್ಣಗೊಂಡಿದೆ! ನಿವ್ವಳ ಸಂಪಾದನೆ: $amount';
  }

  @override
  String get failedToCompleteTrip => 'ಪ್ರಯಾಣ ಪೂರ್ಣಗೊಳಿಸಲು ವಿಫಲವಾಗಿದೆ';

  @override
  String get failedToStartTrip => 'ಪ್ರಯಾಣ ಪ್ರಾರಂಭಿಸಲು ವಿಫಲವಾಗಿದೆ';

  @override
  String get tripCompleted => 'ಪ್ರಯಾಣ ಪೂರ್ಣಗೊಂಡಿದೆ';

  @override
  String get pleaseGoOnline => 'ದಯವಿಟ್ಟು ಮೊದಲು ಆನ್‌ಲೈನ್‌ಗೆ ಹೋಗಿ';

  @override
  String get noDestinationAvailable2 => 'ಯಾವುದೇ ಗಮ್ಯಸ್ಥಾನ ಲಭ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ಗಮ್ಯಸ್ಥಾನವನ್ನು ಹೊಂದಿಸಿ.';

  @override
  String get locationPermissionRequired => 'ಸ್ಥಳ ಅನುಮತಿ ಅಗತ್ಯವಿದೆ';

  @override
  String get locationAccessDenied => 'ಸ್ಥಳ ಪ್ರವೇಶ ನಿರಾಕರಿಸಲಾಗಿದೆ';

  @override
  String get locationPermDenied => 'ಸ್ಥಳ ಅನುಮತಿಯನ್ನು ಶಾಶ್ವತವಾಗಿ ನಿರಾಕರಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಸೆಟ್ಟಿಂಗ್‌ಗಳಲ್ಲಿ ಸಕ್ರಿಯಗೊಳಿಸಿ.';

  @override
  String get openSettings => 'ಸೆಟ್ಟಿಂಗ್‌ಗಳನ್ನು ತೆರೆಯಿರಿ';

  @override
  String get editProfile => 'ಪ್ರೊಫೈಲ್ ಸಂಪಾದಿಸಿ';

  @override
  String get fullNames => 'ಪೂರ್ಣ ಹೆಸರುಗಳು';

  @override
  String get phoneNumbers => 'ಫೋನ್ ಸಂಖ್ಯೆ';

  @override
  String get emailAddress => 'ಇಮೇಲ್ ವಿಳಾಸ';

  @override
  String get vehicleRegistrationNumber => 'ವಾಹನ ನೋಂದಣಿ ಸಂಖ್ಯೆ';

  @override
  String get saveChanges => 'ಬದಲಾವಣೆಗಳನ್ನು ಉಳಿಸಿ';

  @override
  String get profileUpdatedSuccessfully => 'ಪ್ರೊಫೈಲ್ ಯಶಸ್ವಿಯಾಗಿ ನವೀಕರಿಸಲಾಗಿದೆ';

  @override
  String get selectLanguage => 'ಭಾಷೆ ಆಯ್ಕೆಮಾಡಿ';

  @override
  String get applyLanguage => 'ಭಾಷೆ ಅನ್ವಯಿಸಿ';

  @override
  String get languageSwitched => 'ಭಾಷೆ ಯಶಸ್ವಿಯಾಗಿ ಬದಲಾಯಿಸಲಾಗಿದೆ';

  @override
  String get polygonWalletAddress => 'Polygon ವಾಲೆಟ್ ವಿಳಾಸ';

  @override
  String get saveWalletAddress => 'ವಾಲೆಟ್ ವಿಳಾಸ ಉಳಿಸಿ';

  @override
  String get walletAddressUpdated => 'ವಾಲೆಟ್ ವಿಳಾಸ ನವೀಕರಿಸಲಾಗಿದೆ';

  @override
  String get failedToUpdateWallet => 'ವಾಲೆಟ್ ವಿಳಾಸ ನವೀಕರಿಸಲು ವಿಫಲವಾಗಿದೆ';

  @override
  String get helpSupport => 'ಸಹಾಯ ಮತ್ತು ಬೆಂಬಲ';

  @override
  String get browseFAQs => 'FAQs ವೀಕ್ಷಿಸಿ';

  @override
  String get instantAnswers => 'ಸಾಮಾನ್ಯ ಪ್ರಶ್ನೆಗಳಿಗೆ ತಕ್ಷಣದ ಉತ್ತರಗಳನ್ನು ಪಡೆಯಿರಿ';

  @override
  String get aboutTruxifyDriverApp => 'Truxify ಚಾಲಕ ಅಪ್ಲಿಕೇಶನ್ ಬಗ್ಗೆ';

  @override
  String get truxifyDescription => 'Truxify ಒಂದು ಟ್ರಕ್ ಲಾಜಿಸ್ಟಿಕ್ಸ್ ಪ್ಲಾಟ್‌ಫಾರ್ಮ್ ಆಗಿದ್ದು, ಪೂರ್ವ ಆಫ್ರಿಕಾದಾದ್ಯಂತ ಚಾಲಕರನ್ನು ಲೋಡ್‌ಗಳೊಂದಿಗೆ ಸಂಪರ್ಕಿಸುತ್ತದೆ.';

  @override
  String get documents => 'ಡಾಕ್ಯುಮೆಂಟ್‌ಗಳು';

  @override
  String get driverLicensePermitPapers => 'ಚಾಲಕ ಪರವಾನಗಿ ಮತ್ತು ಅನುಮತಿ ಪತ್ರಗಳು';

  @override
  String get notifications => 'ಅಧಿಸೂಚನೆಗಳು';

  @override
  String get viewTripAlerts => 'ಪ್ರಯಾಣ ಎಚ್ಚರಿಕೆಗಳನ್ನು ವೀಕ್ಷಿಸಿ';

  @override
  String get walletAddress => 'ವಾಲೆಟ್ ವಿಳಾಸ';

  @override
  String get notSet => 'ಹೊಂದಿಸಲಾಗಿಲ್ಲ';

  @override
  String get languageLabel => 'ಭಾಷೆ';

  @override
  String get helpAndSupport247 => 'ಸಹಾಯ ಮತ್ತು ಬೆಂಬಲ (24/7)';

  @override
  String get versionAndAppInfo => 'ಆವೃತ್ತಿ ಮತ್ತು ಅಪ್ಲಿಕೇಶನ್ ಮಾಹಿತಿ';

  @override
  String get logout => 'ಲಾಗ್ಔಟ್';

  @override
  String get logoutFailed => 'ಲಾಗ್ಔಟ್ ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';

  @override
  String get myTrips => 'ನನ್ನ ಪ್ರಯಾಣಗಳು';

  @override
  String get marketplace => 'ಮಾರುಕಟ್ಟೆ';

  @override
  String get sortTrips => 'ಪ್ರಯಾಣಗಳನ್ನು ವಿಂಗಡಿಸಿ';

  @override
  String get newestFirst => 'ಹೊಸದನ್ನು ಮೊದಲು';

  @override
  String get oldestFirst => 'ಹಳೆಯದನ್ನು ಮೊದಲು';

  @override
  String get highestEarnings => 'ಹೆಚ್ಚಿನ ಸಂಪಾದನೆ';

  @override
  String get lowestEarnings => 'ಕಡಿಮೆ ಸಂಪಾದನೆ';

  @override
  String get byStatus => 'ಸ್ಥಿತಿಯ ಪ್ರಕಾರ';

  @override
  String get totalTrips => 'ಒಟ್ಟು ಪ್ರಯಾಣಗಳು';

  @override
  String get totalEarned => 'ಒಟ್ಟು ಸಂಪಾದನೆ';

  @override
  String get completion => 'ಪೂರ್ಣಗೊಳಿಸುವಿಕೆ';

  @override
  String get all => 'ಎಲ್ಲಾ';

  @override
  String get active2 => 'ಸಕ್ರಿಯ';

  @override
  String get completed2 => 'ಪೂರ್ಣಗೊಂಡಿದೆ';

  @override
  String get cancelled2 => 'ರದ್ದಾಗಿದೆ';

  @override
  String get failedToLoadTrips => 'ಪ್ರಯಾಣಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ';

  @override
  String get pullDownToRetry => 'ಮರುಪ್ರಯತ್ನಿಸಲು ಕೆಳಗೆ ಎಳೆಯಿರಿ';

  @override
  String get noTripsFound => 'ಯಾವುದೇ ಪ್ರಯಾಣಗಳು ಕಂಡುಬಂದಿಲ್ಲ';

  @override
  String get deliveryStops => 'ಡೆಲಿವರಿ ಸ್ಟಾಪ್‌ಗಳು';

  @override
  String get markCurrentStopCompleted => 'ಪ್ರಸ್ತುತ ಸ್ಟಾಪ್ ಪೂರ್ಣಗೊಂಡಿದೆ ಎಂದು ಗುರುತಿಸಿ';

  @override
  String get activeStatus => 'ಸಕ್ರಿಯ';

  @override
  String get completedStatus => 'ಪೂರ್ಣಗೊಂಡಿದೆ';

  @override
  String get cancelledStatus => 'ರದ್ದಾಗಿದೆ';

  @override
  String get enRouteOpportunities => 'ಮಾರ್ಗದ ಅವಕಾಶಗಳು';

  @override
  String get pickupNearbyLoads => 'ಹತ್ತಿರದ ಲೋಡ್‌ಗಳನ್ನು ಪಿಕಪ್ ಮಾಡಿ';

  @override
  String get marketplaceLoads => 'ಮಾರುಕಟ್ಟೆ ಲೋಡ್‌ಗಳು';

  @override
  String get availableLoadsYouCanBidFor => 'ನೀವು ಬಿಡ್ ಮಾಡಬಹುದಾದ ಲಭ್ಯವಿರುವ ಲೋಡ್‌ಗಳು';

  @override
  String get couldNotLoadMarketplace => 'ಮಾರುಕಟ್ಟೆಯನ್ನು ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ';

  @override
  String get pullToRefresh => 'ರಿಫ್ರೆಶ್ ಮಾಡಲು ಎಳೆಯಿರಿ';

  @override
  String get noLoadsAvailable => 'ಯಾವುದೇ ಲೋಡ್‌ಗಳು ಲಭ್ಯವಿಲ್ಲ';

  @override
  String get bidSubmitted => 'ಬಿಡ್ ಯಶಸ್ವಿಯಾಗಿ ಸಲ್ಲಿಸಲಾಗಿದೆ';

  @override
  String get failedToSubmitBid => 'ಬಿಡ್ ಸಲ್ಲಿಸಲು ವಿಫಲವಾಗಿದೆ';

  @override
  String get thisLoadIsMissingId => 'ಈ ಲೋಡ್‌ನಲ್ಲಿ ID ಇಲ್ಲ';

  @override
  String get recommendedReturnLoads => 'ಶಿಫಾರಸು ಮಾಡಲಾದ ಹಿಂತಿರುಗುವ ಲೋಡ್‌ಗಳು';

  @override
  String get recommendedForYou => 'ನಿಮಗಾಗಿ ಶಿಫಾರಸು ಮಾಡಲಾಗಿದೆ';

  @override
  String get matchScore => 'ಹೊಂದಾಣಿಕೆ ಸ್ಕೋರ್';

  @override
  String get bestMatch => 'ಅತ್ಯುತ್ತಮ ಹೊಂದಾಣಿಕೆ';

  @override
  String get noRecommendations => 'ಯಾವುದೇ ಹಿಂತಿರುಗುವ ಲೋಡ್ ಶಿಫಾರಸುಗಳು ಲಭ್ಯವಿಲ್ಲ';

  @override
  String get couldNotLoadRecommendations => 'ಶಿಫಾರಸುಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ';

  @override
  String get noActiveTripForRecommendations => 'ಹಿಂತಿರುಗುವ ಲೋಡ್ ಸೂಚನೆಗಳನ್ನು ನೋಡಲು ಪ್ರಯಾಣವನ್ನು ಪೂರ್ಣಗೊಳಿಸಿ';

  @override
  String get detourDistance => 'ಡೀಟೂರ್';

  @override
  String get bidOnLoad => 'ಬಿಡ್';

  @override
  String get updateBid => 'ಬಿಡ್ ನವೀಕರಿಸಿ';

  @override
  String get placeYourBid => 'ನಿಮ್ಮ ಬಿಡ್ ಇರಿಸಿ';

  @override
  String get bidAmount => 'ಬಿಡ್ ಮೊತ್ತ';

  @override
  String get submitBid => 'ಬಿಡ್ ಸಲ್ಲಿಸಿ';

  @override
  String get enterValidBid => 'ಮಾನ್ಯ ಬಿಡ್ ಮೊತ್ತವನ್ನು ನಮೂದಿಸಿ';

  @override
  String get unableToOpen => 'ಅಧಿಸೂಚನೆಯನ್ನು ತೆರೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ';

  @override
  String get withdraw => 'ಹಿಂಪಡೆಯಿರಿ';

  @override
  String get withdrawFunds => 'ಹಣ ಹಿಂಪಡೆಯಿರಿ';

  @override
  String get availableBalance => 'ಲಭ್ಯ ಬ್ಯಾಲೆನ್ಸ್';

  @override
  String get enterAmount => 'ಮೊತ್ತ ನಮೂದಿಸಿ';

  @override
  String get amountRequired => 'ಮೊತ್ತ ಅಗತ್ಯವಿದೆ';

  @override
  String get enterValidAmount => 'ದಯವಿಟ್ಟು ಮಾನ್ಯ ಮೊತ್ತವನ್ನು ನಮೂದಿಸಿ';

  @override
  String get amountMustBePositive => 'ಮೊತ್ತವು ಶೂನ್ಯಕ್ಕಿಂತ ಹೆಚ್ಚಿರಬೇಕು';

  @override
  String get insufficientBalance => 'ಅಪರ್ಯಾಪ್ತ ಬ್ಯಾಲೆನ್ಸ್';

  @override
  String get max => 'ಗರಿಷ್ಠ';

  @override
  String get withdrawalSuccessful => 'ಹಿಂಪಡೆಯುವಿಕೆ ಯಶಸ್ವಿಯಾಗಿದೆ';

  @override
  String get networkError => 'Network error. Please check your connection.';

  @override
  String get theme => 'Theme';

  @override
  String get system => 'System';

  @override
  String get light => 'Light';

  @override
  String get dark => 'Dark';

  @override
  String get otpResent => 'OTP resent successfully';

  @override
  String resendOtpIn(int seconds) {
    return 'Resend in $secondss';
  }

  @override
  String get resendOtp => 'Resend OTP';
}
