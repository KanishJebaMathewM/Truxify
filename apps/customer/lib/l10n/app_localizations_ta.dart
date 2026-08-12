// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Tamil (`ta`).
class AppLocalizationsTa extends AppLocalizations {
  AppLocalizationsTa([String locale = 'ta']) : super(locale);

  @override
  String get appTitle => 'Truxify';

  @override
  String get loginTitle => 'Truxify-க்கு வரவேற்கிறோம்';

  @override
  String get bookLoadButton => 'சரக்கு பதிவு செய்யுங்கள்';

  @override
  String get loadingText => 'ஏற்றுகிறது...';

  @override
  String comingSoon(String title) {
    return '$title விரைவில் வருகிறது';
  }

  @override
  String greetingMessage(String greeting, String displayName) {
    return '$greeting, $displayName 👋';
  }

  @override
  String get noActiveShipments => 'செயலில் உள்ள சரக்குகள் இல்லை';

  @override
  String get routeHistoryComingSoon => 'வழிகாட்டி வரலாறு விரைவில் வருகிறது';

  @override
  String get walletAddressUpdated => 'வாலெட் முகவரி புதுப்பிக்கப்பட்டது';

  @override
  String get polygonWalletAddress => 'Polygon வாலெட் முகவரி';

  @override
  String get saveWalletAddress => 'வாலெட் முகவரியைச் சேமியுங்கள்';

  @override
  String error(String errorMsg) {
    return 'பிழை: $errorMsg';
  }

  @override
  String get lightTheme => 'ஒளிர்';

  @override
  String get darkTheme => 'இருண்ட';

  @override
  String get retry => 'மீண்டும் முயற்சிக்கவும்';

  @override
  String get cancel => 'ரத்து செய்';

  @override
  String get save => 'சேமி';

  @override
  String get close => 'மூடு';

  @override
  String get apply => 'பயன்படுத்து';

  @override
  String get reset => 'மீட்டமை';

  @override
  String get search => 'தேடு';

  @override
  String get welcomeBack => 'மீண்டும் வரவேற்கிறோம்';

  @override
  String get signInSubtitle => 'தொடர உள்நுழையுங்கள்';

  @override
  String get phoneNumber => 'தொலைபேசி எண்';

  @override
  String get sendOtp => 'OTP அனுப்பு';

  @override
  String get sendingOtp => 'OTP அனுப்புகிறது...';

  @override
  String get verifyingOtp => 'சரிபார்க்கிறது...';

  @override
  String get verifyOtp => 'OTP சரிபார்';

  @override
  String get loginWithBiometrics => 'பயோமெட்ரிக்ஸ் மூலம் உள்நுழையுங்கள்';

  @override
  String get biometricsNotSupported => 'இந்த சாதனத்தில் பயோமெட்ரிக்ஸ் ஆதரிக்கப்படவில்லை';

  @override
  String get biometricAuthSuccessful => 'பயோமெட்ரிக் அங்கீகாரம் வெற்றிகரமாக முடிந்தது';

  @override
  String get pleaseEnterPhone => 'உங்கள் தொலைபேசி எண்ணை உள்ளிடவும்';

  @override
  String get phoneDigitsOnly => 'தொலைபேசி எண் எண்களை மட்டுமே கொண்டிருக்க வேண்டும்';

  @override
  String phoneMustBeExactDigits(int digitCount) {
    return 'தொலைபேசி எண் சரியாக $digitCount எண்கள் இருக்க வேண்டும்';
  }

  @override
  String get phoneMustBeDigits => 'தொலைபேசி எண் எண்களை மட்டுமே கொண்டிருக்க வேண்டும்';

  @override
  String get verificationFailed => 'சரிபார்ப்பு தோல்வியடைந்தது. மீண்டும் முயற்சிக்கவும்.';

  @override
  String get phoneVerificationFailed => 'தொலைபேசி சரிபார்ப்பு தோல்வியடைந்தது. மீண்டும் முயற்சிக்கவும்.';

  @override
  String get autoVerificationFailed => 'தானியங்கு சரிபார்ப்பு தோல்வியடைந்தது. OTP-ஐ கைமுறையாக உள்ளிடவும்.';

  @override
  String get failedToSendOtp => 'OTP அனுப்ப முடியவில்லை. மீண்டும் முயற்சிக்கவும்.';

  @override
  String get enterOtp => 'OTP உள்ளிடவும்';

  @override
  String sentTo(String phoneNumber) {
    return '$phoneNumber-க்கு அனுப்பப்பட்டது';
  }

  @override
  String get invalidOtp => 'தவறான OTP. சரிபார்த்து மீண்டும் முயற்சிக்கவும்.';

  @override
  String get verificationSessionExpired => 'சரிபார்ப்பு அமர்வு காலாவதியாகிவிட்டது. புதிய OTP கோருங்கள்.';

  @override
  String get invalidVerificationCode => 'தவறான சரிபார்ப்புக் குறியீடு.';

  @override
  String get otpExpired => 'OTP காலாவதியாகிவிட்டது. புதிய ஒன்றைக் கோருங்கள்.';

  @override
  String get home => 'முகப்பு';

  @override
  String get findTrucks => 'லாரிகளைக் கண்டறியுங்கள்';

  @override
  String get orders => 'ஆர்டர்கள்';

  @override
  String get profile => 'சுயவிவரம்';

  @override
  String get activeShipments => 'செயலில் உள்ள சரக்குகள்';

  @override
  String get seeAll => 'அனைத்தும் காண்க';

  @override
  String get bookATruck => 'ஒரு லாரி பதிவு செய்யுங்கள்';

  @override
  String get active => 'செயலில்';

  @override
  String get moreStats => 'மேலும் புள்ளிவிவரங்கள்';

  @override
  String get savings => 'சேமிப்புகள்';

  @override
  String get totalShipments => 'மொத்த சரக்குகள்';

  @override
  String get yourUsualRoutes => 'உங்கள் வழக்கமான வழிகள்';

  @override
  String get lastTruckLocation => 'கடைசி லாரி இருப்பிடம்';

  @override
  String get couldNotLoadData => 'தரவை ஏற்ற முடியவில்லை';

  @override
  String get mlPoweredMatching => 'ML-இயக்கப்படும் பொருத்தம்';

  @override
  String get route => 'வழி';

  @override
  String get pickupLocation => 'ஏற்றும் இடம்';

  @override
  String get dropLocation => 'இறக்கும் இடம்';

  @override
  String get date => 'தேதி';

  @override
  String get time => 'நேரம்';

  @override
  String get goodsDetails => 'சரக்கு விவரங்கள்';

  @override
  String get goodsType => 'சரக்கு வகை';

  @override
  String get weightTonnes => 'எடை (டன்கள்)';

  @override
  String get lengthFt => 'நீளம் (அடி)';

  @override
  String get widthFt => 'அகலம் (அடி)';

  @override
  String get heightFt => 'உயரம் (அடி)';

  @override
  String get stackable => 'அடுக்கக்கூடியது';

  @override
  String get fragile => 'உடையக்கூடியது';

  @override
  String get specialRequirements => 'சிறப்புத் தேவைகள்';

  @override
  String get estimatedPriceRange => 'மதிப்பிடப்பட்ட விலை வரம்பு';

  @override
  String get stableThisWeek => 'இந்த வாரம் நிலையானது';

  @override
  String get estimatingPrice => 'விலை மதிப்பிடப்படுகிறது...';

  @override
  String get estimateUnavailable => 'மதிப்பீடு கிடைக்கவில்லை';

  @override
  String get enterRouteDetails => 'தொடங்க வழிகாட்டி விவரங்களை உள்ளிடவும்';

  @override
  String get basedOnCurrentDemand => 'தற்போதைய தேவையின் அடிப்படையில்';

  @override
  String get filterTrucks => 'லாரிகளை வடிகட்டுங்கள்';

  @override
  String get truckType => 'லாரி வகை';

  @override
  String get capacityTonnes => 'கொள்ளளவு (டன்கள்)';

  @override
  String get materialType => 'பொருள் வகை';

  @override
  String get today => 'இன்று';

  @override
  String get tomorrow => 'நாளை';

  @override
  String get selectPickupOnMap => 'வரைபடத்தில் ஏற்றும் இடத்தைத் தேர்ந்தெடுக்கவும்';

  @override
  String get selectDropOnMap => 'வரைபடத்தில் இறக்கும் இடத்தைத் தேர்ந்தெடுக்கவும்';

  @override
  String get temperatureControl => 'வெப்பநிலை கட்டுப்பாடு';

  @override
  String get waterproofCover => 'நீர்ப்புகா மூடி';

  @override
  String get loadingHelp => 'ஏற்றுதல் உதவி';

  @override
  String get loadingHelpNeeded => 'ஏற்றுதல் உதவி தேவை';

  @override
  String get other => 'மற்றவை';

  @override
  String get describeYourGoods => 'உங்கள் சரக்குகளை விவரியுங்கள்...';

  @override
  String get activeTab => 'செயலில்';

  @override
  String get historyTab => 'வரலாறு';

  @override
  String get searchOrdersHint => 'ஆர்டர்களைத் தேடுங்கள்...';

  @override
  String get noActiveOrders => 'செயலில் உள்ள ஆர்டர்கள் இல்லை';

  @override
  String get noHistoryOrders => 'ஆர்டர் வரலாறு இல்லை';

  @override
  String get offlineMode => 'ஆஃப்லைன் பயன்முறை';

  @override
  String lastUpdated(String timeAgo) {
    return 'கடைசியாகப் புதுப்பிக்கப்பட்டது $timeAgo';
  }

  @override
  String get driverAssigned => 'ஓட்டுநர் நியமிக்கப்பட்டார்';

  @override
  String get inTransit => 'போக்குவரத்தில் உள்ளது';

  @override
  String get paymentReleased => 'பணம் விடுவிக்கப்பட்டது';

  @override
  String get delivered => 'வழங்கப்பட்டது';

  @override
  String get cancelled => 'ரத்து செய்யப்பட்டது';

  @override
  String get pending => 'நிலுவையில் உள்ளது';

  @override
  String get account => 'கணக்கு';

  @override
  String get preferences => 'விருப்பத்தேர்வுகள்';

  @override
  String get paymentMethods => 'பணம் செலுத்தும் முறைகள்';

  @override
  String get myDocuments => 'என் ஆவணங்கள்';

  @override
  String get savedAddresses => 'சேமிக்கப்பட்ட முகவரிகள்';

  @override
  String get walletAddressLabel => 'வாலெட் முகவரி';

  @override
  String get notSet => 'அமைக்கப்படவில்லை';

  @override
  String get language => 'மொழி';

  @override
  String get helpSupport => 'உதவி மற்றும் ஆதரவு';

  @override
  String get aboutTruxify => 'Truxify பற்றி';

  @override
  String get logout => 'வெளியேறு';

  @override
  String offlineModeLabel(String timeAgo) {
    return 'ஆஃப்லைன் பயன்முறை (கடைசியாகப் புதுப்பிக்கப்பட்டது $timeAgo)';
  }

  @override
  String get ordersLabel => 'ஆர்டர்கள்';

  @override
  String get savedLabel => 'சேமிக்கப்பட்டது';

  @override
  String get co2Label => 'CO₂ சேமிக்கப்பட்டது';

  @override
  String get editProfile => 'சுயவிவரத்தைத் திருத்து';

  @override
  String get fullName => 'முழுப்பெயர்';

  @override
  String get companyName => 'நிறுவனப் பெயர்';

  @override
  String get phone => 'தொலைபேசி';

  @override
  String get enterFullName => 'உங்கள் முழுப்பெயரை உள்ளிடவும்';

  @override
  String get enterCompanyName => 'உங்கள் நிறுவனப் பெயரை உள்ளிடவும்';

  @override
  String get enterPhoneNumber => 'உங்கள் தொலைபேசி எண்ணை உள்ளிடவும்';

  @override
  String get nameIsRequired => 'பெயர் கட்டாயம்';

  @override
  String get companyNameIsRequired => 'நிறுவனப் பெயர் கட்டாயம்';

  @override
  String get phoneNumberIsRequired => 'தொலைபேசி எண் கட்டாயம்';

  @override
  String get saving => 'சேமிக்கிறது...';

  @override
  String get saveChanges => 'மாற்றங்களைச் சேமியுங்கள்';

  @override
  String get profileUpdatedSuccessfully => 'சுயவிவரம் வெற்றிகரமாகப் புதுப்பிக்கப்பட்டது';

  @override
  String get failedToLoadProfile => 'சுயவிவரத்தை ஏற்ற முடியவில்லை';

  @override
  String get failedToUpdateProfile => 'சுயவிவரத்தைப் புதுப்பிக்க முடியவில்லை';

  @override
  String get shareTracking => 'கண்காணிப்பைப் பகிருங்கள்';

  @override
  String get trackingLinkGenerated => 'கண்காணிப்பு இணைப்பு உருவாக்கப்பட்டது';

  @override
  String get unableToShare => 'பகிர முடியவில்லை';

  @override
  String get linkExpired => 'இந்தக் கண்காணிப்பு இணைப்பு காலாவதியாகிவிட்டது அல்லது இனி செல்லுபடியாகாது.';

  @override
  String get trackingRevoked => 'அனைத்து கண்காணிப்பு இணைப்புகளும் ரத்து செய்யப்பட்டன.';

  @override
  String get copyLink => 'இணைப்பை நகலெடு';

  @override
  String get shareMessage => 'Truxify-ல் உங்கள் சரக்கைக் கண்காணியுங்கள்';

  @override
  String get orderNotFound => 'ஆர்டர் கிடைக்கவில்லை';

  @override
  String get notification => 'அறிவிப்பு';

  @override
  String get unableToOpen => 'அறிவிப்பைத் திறக்க முடியவில்லை';

  @override
  String get downloadInvoice => 'விலைப்பட்டியலைப் பதிவிறக்கு';

  @override
  String get generatingInvoice => 'விலைப்பட்டியல் உருவாக்கப்படுகிறது...';

  @override
  String get invoiceReady => 'விலைப்பட்டியல் தயாராக உள்ளது';

  @override
  String get shareInvoice => 'விலைப்பட்டியலைப் பகிருங்கள்';

  @override
  String get printInvoice => 'விலைப்பட்டியலை அச்சிடுங்கள்';

  @override
  String get downloadFailed => 'பதிவிறக்கம் தோல்வியடைந்தது';

  @override
  String get networkError => 'Network error. Please check your connection.';

  @override
  String get english => 'ஆங்கிலம்';

  @override
  String get hindi => 'இந்தி';

  @override
  String get tamil => 'தமிழ்';
}
