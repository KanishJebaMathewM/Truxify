// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Kannada (`kn`).
class AppLocalizationsKn extends AppLocalizations {
  AppLocalizationsKn([String locale = 'kn']) : super(locale);

  @override
  String get appTitle => 'Truxify';

  @override
  String get loginTitle => 'Truxify ಗೆ ಸುಸ್ವಾಗತ';

  @override
  String get bookLoadButton => 'ಲೋಡ್ ಬುಕ್ ಮಾಡಿ';

  @override
  String get loadingText => 'ಲೋಡ್ ಆಗುತ್ತಿದೆ...';

  @override
  String comingSoon(String title) {
    return '$title ಶೀಘ್ರದಲ್ಲೇ ಬರುತ್ತಿದೆ';
  }

  @override
  String greetingMessage(String greeting, String displayName) {
    return '$greeting, $displayName 👋';
  }

  @override
  String get noActiveShipments => 'ಸಕ್ರಿಯ ಸರಕು ಸಾಗಣೆ ಇಲ್ಲ';

  @override
  String get routeHistoryComingSoon => 'ಮಾರ್ಗ ಇತಿಹಾಸ ಶೀಘ್ರದಲ್ಲೇ ಬರುತ್ತಿದೆ';

  @override
  String get walletAddressUpdated => 'ವಾಲೆಟ್ ವಿಳಾಸ ನವೀಕರಿಸಲಾಗಿದೆ';

  @override
  String get polygonWalletAddress => 'ಪಾಲಿಗಾನ್ ವಾಲೆಟ್ ವಿಳಾಸ';

  @override
  String get saveWalletAddress => 'ವಾಲೆಟ್ ವಿಳಾಸ ಉಳಿಸಿ';

  @override
  String error(String errorMsg) {
    return 'ದೋಷ: $errorMsg';
  }

  @override
  String get lightTheme => 'ಬೆಳಕು';

  @override
  String get darkTheme => 'ಗಾಢ';

  @override
  String get retry => 'ಮರುಪ್ರಯತ್ನಿಸಿ';

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
  String get welcomeBack => 'ಮತ್ತೆ ಸುಸ್ವಾಗತ';

  @override
  String get signInSubtitle => 'ಮುಂದುವರಿಯಲು ಸೈನ್ ಇನ್ ಮಾಡಿ';

  @override
  String get phoneNumber => 'ಫೋನ್ ಸಂಖ್ಯೆ';

  @override
  String get sendOtp => 'OTP ಕಳುಹಿಸಿ';

  @override
  String get sendingOtp => 'OTP ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ...';

  @override
  String get verifyingOtp => 'ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ...';

  @override
  String get verifyOtp => 'OTP ಪರಿಶೀಲಿಸಿ';

  @override
  String get loginWithBiometrics => 'ಬಯೋಮೆಟ್ರಿಕ್ಸ್‌ನೊಂದಿಗೆ ಲಾಗಿನ್ ಮಾಡಿ';

  @override
  String get biometricsNotSupported => 'ಈ ಸಾಧನದಲ್ಲಿ ಬಯೋಮೆಟ್ರಿಕ್ಸ್ ಬೆಂಬಲಿಸುವುದಿಲ್ಲ';

  @override
  String get biometricAuthSuccessful => 'ಬಯೋಮೆಟ್ರಿಕ್ ದೃಢೀಕರಣ ಯಶಸ್ವಿಯಾಗಿದೆ';

  @override
  String get pleaseEnterPhone => 'ದಯವಿಟ್ಟು ನಿಮ್ಮ ಫೋನ್ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ';

  @override
  String get phoneDigitsOnly => 'ಫೋನ್ ಸಂಖ್ಯೆಯಲ್ಲಿ ಕೇವಲ ಅಂಕಿಗಳಿರಬೇಕು';

  @override
  String phoneMustBeExactDigits(int digitCount) {
    return 'ಫೋನ್ ಸಂಖ್ಯೆಯು ನಿಖರವಾಗಿ $digitCount ಅಂಕಿಗಳನ್ನು ಹೊಂದಿರಬೇಕು';
  }

  @override
  String get phoneMustBeDigits => 'ಫೋನ್ ಸಂಖ್ಯೆಯಲ್ಲಿ ಕೇವಲ ಅಂಕಿಗಳಿರಬೇಕು';

  @override
  String get verificationFailed => 'ಪರಿಶೀಲನೆ ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';

  @override
  String get phoneVerificationFailed => 'ಫೋನ್ ಪರಿಶೀಲನೆ ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';

  @override
  String get autoVerificationFailed => 'ಸ್ವಯಂ-ಪರಿಶೀಲನೆ ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು OTP ಯನ್ನು ಹಸ್ತಚಾಲಿತವಾಗಿ ನಮೂದಿಸಿ.';

  @override
  String get failedToSendOtp => 'OTP ಕಳುಹಿಸಲು ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';

  @override
  String get enterOtp => 'OTP ನಮೂದಿಸಿ';

  @override
  String sentTo(String phoneNumber) {
    return '$phoneNumber ಗೆ ಕಳುಹಿಸಲಾಗಿದೆ';
  }

  @override
  String get invalidOtp => 'ಅಮಾನ್ಯ OTP. ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ ಮತ್ತು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';

  @override
  String get verificationSessionExpired => 'ಪರಿಶೀಲನಾ ಅಧಿವೇಶನ ಅವಧಿ ಮುಗಿದಿದೆ. ದಯವಿಟ್ಟು ಹೊಸ OTP ವಿನಂತಿಸಿ.';

  @override
  String get invalidVerificationCode => 'ಅಮಾನ್ಯ ಪರಿಶೀಲನಾ ಕೋಡ್.';

  @override
  String get otpExpired => 'OTP ಅವಧಿ ಮುಗಿದಿದೆ. ದಯವಿಟ್ಟು ಹೊಸದನ್ನು ವಿನಂತಿಸಿ.';

  @override
  String get home => 'ಹೋಮ್';

  @override
  String get findTrucks => 'ಟ್ರಕ್‌ಗಳನ್ನು ಹುಡುಕಿ';

  @override
  String get orders => 'ಆದೇಶಗಳು';

  @override
  String get profile => 'ಪ್ರೊಫೈಲ್';

  @override
  String get activeShipments => 'ಸಕ್ರಿಯ ಸರಕು ಸಾಗಣೆ';

  @override
  String get seeAll => 'ಎಲ್ಲವನ್ನೂ ನೋಡಿ';

  @override
  String get bookATruck => 'ಟ್ರಕ್ ಬುಕ್ ಮಾಡಿ';

  @override
  String get active => 'ಸಕ್ರಿಯ';

  @override
  String get moreStats => 'ಹೆಚ್ಚಿನ ಅಂಕಿಅಂಶಗಳು';

  @override
  String get savings => 'ಉಳಿತಾಯ';

  @override
  String get totalShipments => 'ಒಟ್ಟು ಸರಕು ಸಾಗಣೆ';

  @override
  String get yourUsualRoutes => 'ನಿಮ್ಮ ಸಾಮಾನ್ಯ ಮಾರ್ಗಗಳು';

  @override
  String get lastTruckLocation => 'ಕೊನೆಯ ಟ್ರಕ್ ಸ್ಥಳ';

  @override
  String get couldNotLoadData => 'ಡೇಟಾ ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ';

  @override
  String get mlPoweredMatching => 'ML-ಆಧಾರಿತ ಹೊಂದಾಣಿಕೆ';

  @override
  String get route => 'ಮಾರ್ಗ';

  @override
  String get pickupLocation => 'ಪಿಕಪ್ ಸ್ಥಳ';

  @override
  String get dropLocation => 'ಡ್ರಾಪ್ ಸ್ಥಳ';

  @override
  String get date => 'ದಿನಾಂಕ';

  @override
  String get time => 'ಸಮಯ';

  @override
  String get goodsDetails => 'ಸರಕು ವಿವರಗಳು';

  @override
  String get goodsType => 'ಸರಕು ಪ್ರಕಾರ';

  @override
  String get weightTonnes => 'ತೂಕ (ಟನ್‌ಗಳು)';

  @override
  String get lengthFt => 'ಉದ್ದ (ಅಡಿ)';

  @override
  String get widthFt => 'ಅಗಲ (ಅಡಿ)';

  @override
  String get heightFt => 'ಎತ್ತರ (ಅಡಿ)';

  @override
  String get stackable => 'ಜೋಡಿಸಬಹುದಾದ';

  @override
  String get fragile => 'ಜೋರಾದ';

  @override
  String get specialRequirements => 'ವಿಶೇಷ ಅಗತ್ಯಗಳು';

  @override
  String get estimatedPriceRange => 'ಅಂದಾಜು ಬೆಲೆ ಶ್ರೇಣಿ';

  @override
  String get stableThisWeek => 'ಈ ವಾರ ಸ್ಥಿರ';

  @override
  String get estimatingPrice => 'ಬೆಲೆ ಅಂದಾಜು ಮಾಡಲಾಗುತ್ತಿದೆ...';

  @override
  String get estimateUnavailable => 'ಅಂದಾಜು ಲಭ್ಯವಿಲ್ಲ';

  @override
  String get enterRouteDetails => 'ಪ್ರಾರಂಭಿಸಲು ಮಾರ್ಗ ವಿವರಗಳನ್ನು ನಮೂದಿಸಿ';

  @override
  String get basedOnCurrentDemand => 'ಪ್ರಸ್ತುತ ಬೇಡಿಕೆಯ ಆಧಾರದ ಮೇಲೆ';

  @override
  String get filterTrucks => 'ಟ್ರಕ್‌ಗಳನ್ನು ಫಿಲ್ಟರ್ ಮಾಡಿ';

  @override
  String get truckType => 'ಟ್ರಕ್ ಪ್ರಕಾರ';

  @override
  String get capacityTonnes => 'ಸಾಮರ್ಥ್ಯ (ಟನ್‌ಗಳು)';

  @override
  String get materialType => 'ವಸ್ತು ಪ್ರಕಾರ';

  @override
  String get today => 'ಇಂದು';

  @override
  String get tomorrow => 'ನಾಳೆ';

  @override
  String get selectPickupOnMap => 'ನಕ್ಷೆಯಲ್ಲಿ ಪಿಕಪ್ ಆಯ್ಕೆಮಾಡಿ';

  @override
  String get selectDropOnMap => 'ನಕ್ಷೆಯಲ್ಲಿ ಡ್ರಾಪ್ ಆಯ್ಕೆಮಾಡಿ';

  @override
  String get temperatureControl => 'ತಾಪಮಾನ ನಿಯಂತ್ರಣ';

  @override
  String get waterproofCover => 'ನೀರಾಡಿಕೆ ಹೊದಿಕೆ';

  @override
  String get loadingHelp => 'ಲೋಡಿಂಗ್ ಸಹಾಯ';

  @override
  String get loadingHelpNeeded => 'ಲೋಡಿಂಗ್ ಸಹಾಯ ಅಗತ್ಯವಿದೆ';

  @override
  String get other => 'ಇತರೆ';

  @override
  String get describeYourGoods => 'ನಿಮ್ಮ ಸರಕುಗಳನ್ನು ವಿವರಿಸಿ...';

  @override
  String get activeTab => 'ಸಕ್ರಿಯ';

  @override
  String get historyTab => 'ಇತಿಹಾಸ';

  @override
  String get searchOrdersHint => 'ಆದೇಶಗಳನ್ನು ಹುಡುಕಿ...';

  @override
  String get noActiveOrders => 'ಸಕ್ರಿಯ ಆದೇಶಗಳಿಲ್ಲ';

  @override
  String get noHistoryOrders => 'ಆದೇಶ ಇತಿಹಾಸವಿಲ್ಲ';

  @override
  String get offlineMode => 'ಆಫ್‌ಲೈನ್ ಮೋಡ್';

  @override
  String lastUpdated(String timeAgo) {
    return 'ಕೊನೆಯ ನವೀಕರಣ $timeAgo';
  }

  @override
  String get driverAssigned => 'ಚಾಲಕ ನಿಯೋಜಿಸಲಾಗಿದೆ';

  @override
  String get inTransit => 'ಸಾಗಣೆಯಲ್ಲಿದೆ';

  @override
  String get paymentReleased => 'ಪಾವತಿ ಬಿಡುಗಡೆಯಾಗಿದೆ';

  @override
  String get delivered => 'ತಲುಪಿಸಲಾಗಿದೆ';

  @override
  String get cancelled => 'ರದ್ದುಮಾಡಲಾಗಿದೆ';

  @override
  String get pending => 'ಬಾಕಿ ಇದೆ';

  @override
  String get account => 'ಖಾತೆ';

  @override
  String get preferences => 'ಆದ್ಯತೆಗಳು';

  @override
  String get paymentMethods => 'ಪಾವತಿ ವಿಧಾನಗಳು';

  @override
  String get myDocuments => 'ನನ್ನ ಡಾಕ್ಯುಮೆಂಟ್‌ಗಳು';

  @override
  String get savedAddresses => 'ಉಳಿಸಿದ ವಿಳಾಸಗಳು';

  @override
  String get walletAddressLabel => 'ವಾಲೆಟ್ ವಿಳಾಸ';

  @override
  String get notSet => 'ಹೊಂದಿಸಿಲ್ಲ';

  @override
  String get language => 'ಭಾಷೆ';

  @override
  String get helpSupport => 'ಸಹಾಯ & ಬೆಂಬಲ';

  @override
  String get aboutTruxify => 'Truxify ಬಗ್ಗೆ';

  @override
  String get logout => 'ಲಾಗ್‌ಔಟ್';

  @override
  String offlineModeLabel(String timeAgo) {
    return 'ಆಫ್‌ಲೈನ್ ಮೋಡ್ (ಕೊನೆಯ ನವೀಕರಣ $timeAgo)';
  }

  @override
  String get ordersLabel => 'ಆದೇಶಗಳು';

  @override
  String get savedLabel => 'ಉಳಿಸಿದೆ';

  @override
  String get co2Label => 'CO₂ ಉಳಿಸಿದೆ';

  @override
  String get editProfile => 'ಪ್ರೊಫೈಲ್ ಸಂಪಾದಿಸಿ';

  @override
  String get fullName => 'ಪೂರ್ಣ ಹೆಸರು';

  @override
  String get companyName => 'ಕಂಪನಿ ಹೆಸರು';

  @override
  String get phone => 'ಫೋನ್';

  @override
  String get enterFullName => 'ನಿಮ್ಮ ಪೂರ್ಣ ಹೆಸರು ನಮೂದಿಸಿ';

  @override
  String get enterCompanyName => 'ನಿಮ್ಮ ಕಂಪನಿ ಹೆಸರು ನಮೂದಿಸಿ';

  @override
  String get enterPhoneNumber => 'ನಿಮ್ಮ ಫೋನ್ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ';

  @override
  String get nameIsRequired => 'ಹೆಸರು ಅಗತ್ಯವಿದೆ';

  @override
  String get companyNameIsRequired => 'ಕಂಪನಿ ಹೆಸರು ಅಗತ್ಯವಿದೆ';

  @override
  String get phoneNumberIsRequired => 'ಫೋನ್ ಸಂಖ್ಯೆ ಅಗತ್ಯವಿದೆ';

  @override
  String get saving => 'ಉಳಿಸಲಾಗುತ್ತಿದೆ...';

  @override
  String get saveChanges => 'ಬದಲಾವಣೆಗಳನ್ನು ಉಳಿಸಿ';

  @override
  String get profileUpdatedSuccessfully => 'ಪ್ರೊಫೈಲ್ ಯಶಸ್ವಿಯಾಗಿ ನವೀಕರಿಸಲಾಗಿದೆ';

  @override
  String get failedToLoadProfile => 'ಪ್ರೊಫೈಲ್ ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ';

  @override
  String get failedToUpdateProfile => 'ಪ್ರೊಫೈಲ್ ನವೀಕರಿಸಲು ವಿಫಲವಾಗಿದೆ';

  @override
  String get shareTracking => 'ಟ್ರ್ಯಾಕಿಂಗ್ ಹಂಚಿಕೊಳ್ಳಿ';

  @override
  String get trackingLinkGenerated => 'ಟ್ರ್ಯಾಕಿಂಗ್ ಲಿಂಕ್ ರಚಿಸಲಾಗಿದೆ';

  @override
  String get unableToShare => 'ಹಂಚಿಕೊಳ್ಳಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ';

  @override
  String get linkExpired => 'ಈ ಟ್ರ್ಯಾಕಿಂಗ್ ಲಿಂಕ್ ಅವಧಿ ಮುಗಿದಿದೆ ಅಥವಾ ಇನ್ನು ಮಾನ್ಯವಾಗಿಲ್ಲ.';

  @override
  String get trackingRevoked => 'ಎಲ್ಲಾ ಟ್ರ್ಯಾಕಿಂಗ್ ಲಿಂಕ್‌ಗಳನ್ನು ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ.';

  @override
  String get copyLink => 'ಲಿಂಕ್ ನಕಲಿಸಿ';

  @override
  String get shareMessage => 'Truxify ನಲ್ಲಿ ನಿಮ್ಮ ಸರಕು ಸಾಗಣೆಯನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡಿ';

  @override
  String get orderNotFound => 'ಆದೇಶ ಕಂಡುಬಂದಿಲ್ಲ';

  @override
  String get notification => 'ಅಧಿಸೂಚನೆ';

  @override
  String get unableToOpen => 'ಅಧಿಸೂಚನೆಯನ್ನು ತೆರೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ';

  @override
  String get downloadInvoice => 'ಇನ್‌ವಾಯ್ಸ್ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ';

  @override
  String get generatingInvoice => 'ಇನ್‌ವಾಯ್ಸ್ ರಚಿಸಲಾಗುತ್ತಿದೆ...';

  @override
  String get invoiceReady => 'ಇನ್‌ವಾಯ್ಸ್ ಸಿದ್ಧವಾಗಿದೆ';

  @override
  String get shareInvoice => 'ಇನ್‌ವಾಯ್ಸ್ ಹಂಚಿಕೊಳ್ಳಿ';

  @override
  String get printInvoice => 'ಇನ್‌ವಾಯ್ಸ್ ಮುದ್ರಿಸಿ';

  @override
  String get downloadFailed => 'ಡೌನ್‌ಲೋಡ್ ವಿಫಲವಾಗಿದೆ';

  @override
  String get networkError => 'Network error. Please check your connection.';
}
