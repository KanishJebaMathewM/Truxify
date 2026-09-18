// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Tamil (`ta`).
class AppLocalizationsTa extends AppLocalizations {
  AppLocalizationsTa([String locale = 'ta']) : super(locale);

  @override
  String get appTitle => 'ட்ரக்ஸிஃபை ஓட்டுநர்';

  @override
  String get loadingText => 'ஏற்றுகிறது...';

  @override
  String get retry => 'மீண்டும் முயற்சி';

  @override
  String get error => 'பிழை';

  @override
  String get cancel => 'ரத்துசெய்';

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
  String get welcomeDriver => 'வரவேற்கிறோம், ஓட்டுநர்!';

  @override
  String get logInToStartEarning => 'சம்பாதிக்கத் தொடங்க உள்நுழையுங்கள்';

  @override
  String get phoneNumber => 'தொலைபேசி எண்';

  @override
  String get sendOtp => 'OTP அனுப்பு';

  @override
  String get sending => 'அனுப்புகிறது...';

  @override
  String get verificationFailed => 'சரிபார்ப்பு தோல்வியடைந்தது';

  @override
  String get pleaseEnterPhone => 'தயவுசெய்து உங்கள் தொலைபேசி எண்ணை உள்ளிடவும்';

  @override
  String get enterValidPhone => 'தயவுசெய்து சரியான தொலைபேசி எண்ணை உள்ளிடவும்';

  @override
  String phoneMustBeExactDigits(int digitCount) {
    return 'தொலைபேசி எண் சரியாக $digitCount இலக்கங்களாக இருக்க வேண்டும்';
  }

  @override
  String get phoneMustBeDigits => 'தொலைபேசி எண் இலக்கங்களை மட்டும் கொண்டிருக்க வேண்டும்';

  @override
  String get autoVerificationFailed => 'தானியங்கு சரிபார்ப்பு தோல்வியடைந்தது. தயவுசெய்து OTP ஐ கைமுறையாக உள்ளிடவும்.';

  @override
  String get protectedDriverAccess => 'இப்பகுதி பதிவுசெய்யப்பட்ட ஓட்டுநர்களுக்கு மட்டுமே.';

  @override
  String get verifyOtp => 'OTP ஐ சரிபார்';

  @override
  String get enterOtp => 'உங்கள் தொலைபேசிக்கு அனுப்பப்பட்ட OTP ஐ உள்ளிடவும்';

  @override
  String sentTo(String phoneNumber) {
    return '$phoneNumber க்கு அனுப்பப்பட்டது';
  }

  @override
  String get invalidOtp => 'தவறான OTP. தயவுசெய்து மீண்டும் முயற்சிக்கவும்.';

  @override
  String get codeExpired => 'OTP காலாவதியாகிவிட்டது. தயவுசெய்து புதியதைக் கோருங்கள்.';

  @override
  String get verificationFailedMsg => 'சரிபார்ப்பு தோல்வியடைந்தது. தயவுசெய்து மீண்டும் முயற்சிக்கவும்.';

  @override
  String get couldNotVerifyOtp => 'OTP ஐ சரிபார்க்க முடியவில்லை. தயவுசெய்து மீண்டும் முயற்சிக்கவும்.';

  @override
  String get verifying => 'சரிபார்க்கிறது...';

  @override
  String get home => 'முகப்பு';

  @override
  String get trips => 'பயணங்கள்';

  @override
  String get earnings => 'வருமானம்';

  @override
  String get profile => 'சுயவிவரம்';

  @override
  String get offlineUsingCachedData => 'நீங்கள் ஆஃப்லைனில் உள்ளீர்கள். தற்காலிக தரவைப் பயன்படுத்துகிறது.';

  @override
  String get newLoadAvailable => 'புதிய சரக்கு கிடைக்கிறது!';

  @override
  String get view => 'பார்';

  @override
  String get navigationActive => 'வழிசெலுத்தல் செயலில் உள்ளது';

  @override
  String headingTo(String destination) {
    return '$destination க்கு செல்கிறது';
  }

  @override
  String get locating => 'உங்கள் இருப்பை கண்டறிகிறது...';

  @override
  String get locationUnavailable => 'இருப்பு கிடைக்கவில்லை';

  @override
  String get currentLocation => 'தற்போதைய இருப்பு';

  @override
  String get tapToRefresh => 'புதுப்பிக்க தட்டவும்';

  @override
  String get fetchingLocation => 'உங்கள் இருப்பை பெறுகிறது...';

  @override
  String get whereAreYouHeading => 'நீங்கள் எங்கு செல்கிறீர்கள்?';

  @override
  String get onlineAndReady => 'ஆன்லைன் & தயார்';

  @override
  String get offline => 'ஆஃப்லைன்';

  @override
  String get offlineGoOnline => 'நீங்கள் ஆஃப்லைனில் உள்ளீர்கள். சரக்குகளைப் பெற ஆன்லைனில் செல்லுங்கள்.';

  @override
  String get radarActiveFetching => 'ரேடார் செயலில் — அருகிலுள்ள சரக்குகளைப் பெறுகிறது...';

  @override
  String get radarActiveLooking => 'ரேடார் செயலில் — உங்கள் அருகில் சரக்குகளைத் தேடுகிறது.';

  @override
  String get todayPay => 'இன்றைய ஊதியம்';

  @override
  String get shiftHours => 'பணிநேரம்';

  @override
  String get rating => 'மதிப்பீடு';

  @override
  String get metricsUnavailable => 'அளவீடுகள் கிடைக்கவில்லை';

  @override
  String get noDestinationAvailable => 'இலக்கு அமைக்கப்படவில்லை';

  @override
  String get currentLocationUnavailable => 'தற்போதைய இருப்பு கிடைக்கவில்லை';

  @override
  String get unableToOpenGoogleMaps => 'Google Maps ஐ திறக்க முடியவில்லை';

  @override
  String get failedToGenerateRoute => 'வழியை உருவாக்க முடியவில்லை';

  @override
  String get enRoute => 'வழியில்';

  @override
  String get assignedLoad => 'ஒதுக்கப்பட்ட சரக்கு';

  @override
  String get distance => 'தொலைவு';

  @override
  String get estDuration => 'மதிப்பிடப்பட்ட காலம்';

  @override
  String get estPayout => 'மதிப்பிடப்பட்ட பணம்';

  @override
  String get slideToCompleteTrip => 'பயணத்தை நிறைவு செய்ய ஸ்லைடு செய்யுங்கள்';

  @override
  String get slideToStartTrip => 'பயணத்தைத் தொடங்க ஸ்லைடு செய்யுங்கள்';

  @override
  String get cancelAssignment => 'ஒதுக்கீட்டை ரத்துசெய்';

  @override
  String tripCompletedNetEarnings(String amount) {
    return 'பயணம் நிறைவடைந்தது! நிகர வருமானம்: $amount';
  }

  @override
  String get failedToCompleteTrip => 'பயணத்தை நிறைவு செய்ய முடியவில்லை';

  @override
  String get failedToStartTrip => 'பயணத்தைத் தொடங்க முடியவில்லை';

  @override
  String get tripCompleted => 'பயணம் நிறைவடைந்தது';

  @override
  String get pleaseGoOnline => 'தயவுசெய்து முதலில் ஆன்லைனில் செல்லுங்கள்';

  @override
  String get noDestinationAvailable2 => 'இலக்கு கிடைக்கவில்லை. தயவுசெய்து இலக்கை அமையுங்கள்.';

  @override
  String get locationPermissionRequired => 'இருப்பு அனுமதி தேவை';

  @override
  String get locationAccessDenied => 'இருப்பு அணுகல் மறுக்கப்பட்டது';

  @override
  String get locationPermDenied => 'இருப்பு அனுமதி நிரந்தரமாக மறுக்கப்பட்டது. தயவுசெய்து அமைப்புகளில் இயக்குங்கள்.';

  @override
  String get openSettings => 'அமைப்புகளைத் திற';

  @override
  String get editProfile => 'சுயவிவரத்தைத் திருத்து';

  @override
  String get fullNames => 'முழு பெயர்கள்';

  @override
  String get phoneNumbers => 'தொலைபேசி எண்';

  @override
  String get emailAddress => 'மின்னஞ்சல் முகவரி';

  @override
  String get vehicleRegistrationNumber => 'வாகன பதிவு எண்';

  @override
  String get saveChanges => 'மாற்றங்களைச் சேமி';

  @override
  String get profileUpdatedSuccessfully => 'சுயவிவரம் வெற்றிகரமாக புதுப்பிக்கப்பட்டது';

  @override
  String get selectLanguage => 'மொழியைத் தேர்ந்தெடு';

  @override
  String get applyLanguage => 'மொழியைப் பயன்படுத்து';

  @override
  String get languageSwitched => 'மொழி வெற்றிகரமாக மாற்றப்பட்டது';

  @override
  String get polygonWalletAddress => 'Polygon பணப்பை முகவரி';

  @override
  String get saveWalletAddress => 'பணப்பை முகவரியைச் சேமி';

  @override
  String get walletAddressUpdated => 'பணப்பை முகவரி புதுப்பிக்கப்பட்டது';

  @override
  String get failedToUpdateWallet => 'பணப்பை முகவரியைப் புதுப்பிக்க முடியவில்லை';

  @override
  String get helpSupport => 'உதவி & ஆதரவு';

  @override
  String get browseFAQs => 'அடிக்கடி கேட்கப்படும் கேள்விகளை உலாவு';

  @override
  String get instantAnswers => 'பொதுவான கேள்விகளுக்கு உடனடி பதில்களைப் பெறுங்கள்';

  @override
  String get aboutTruxifyDriverApp => 'Truxify ஓட்டுநர் பயன்பாடு பற்றி';

  @override
  String get truxifyDescription => 'Truxify என்பது கிழக்கு ஆப்பிரிக்கா முழுவதும் ஓட்டுநர்களை சரக்குகளுடன் இணைக்கும் லாரி தளவாட தளம்.';

  @override
  String get documents => 'ஆவணங்கள்';

  @override
  String get driverLicensePermitPapers => 'ஓட்டுநர் உரிமம் & அனுமதி ஆவணங்கள்';

  @override
  String get notifications => 'அறிவிப்புகள்';

  @override
  String get viewTripAlerts => 'பயண எச்சரிக்கைகளைக் காண்';

  @override
  String get walletAddress => 'பணப்பை முகவரி';

  @override
  String get notSet => 'அமைக்கப்படவில்லை';

  @override
  String get languageLabel => 'மொழி';

  @override
  String get helpAndSupport247 => 'உதவி & ஆதரவு (24/7)';

  @override
  String get versionAndAppInfo => 'பதிப்பு & பயன்பாட்டு தகவல்';

  @override
  String get logout => 'வெளியேறு';

  @override
  String get logoutFailed => 'வெளியேற்றம் தோல்வியடைந்தது. தயவுசெய்து மீண்டும் முயற்சிக்கவும்.';

  @override
  String get myTrips => 'என் பயணங்கள்';

  @override
  String get marketplace => 'சந்தை';

  @override
  String get sortTrips => 'பயணங்களை வரிசைப்படுத்து';

  @override
  String get newestFirst => 'சமீபத்தியது முதலில்';

  @override
  String get oldestFirst => 'பழமையானது முதலில்';

  @override
  String get highestEarnings => 'அதிகபட்ச வருமானம்';

  @override
  String get lowestEarnings => 'குறைந்தபட்ச வருமானம்';

  @override
  String get byStatus => 'நிலை வாரியாக';

  @override
  String get totalTrips => 'மொத்த பயணங்கள்';

  @override
  String get totalEarned => 'மொத்த சம்பாதிப்பு';

  @override
  String get completion => 'நிறைவு';

  @override
  String get all => 'அனைத்தும்';

  @override
  String get active2 => 'செயலில்';

  @override
  String get completed2 => 'நிறைவடைந்தது';

  @override
  String get cancelled2 => 'ரத்துசெய்யப்பட்டது';

  @override
  String get failedToLoadTrips => 'பயணங்களை ஏற்ற முடியவில்லை';

  @override
  String get pullDownToRetry => 'மீண்டும் முயற்சிக்க கீழே இழுக்கவும்';

  @override
  String get noTripsFound => 'பயணங்கள் எதுவும் கிடைக்கவில்லை';

  @override
  String get deliveryStops => 'டெலிவரி நிறுத்தங்கள்';

  @override
  String get markCurrentStopCompleted => 'தற்போதைய நிறுத்தத்தை நிறைவடைந்ததாகக் குறி';

  @override
  String get activeStatus => 'செயலில்';

  @override
  String get completedStatus => 'நிறைவடைந்தது';

  @override
  String get cancelledStatus => 'ரத்துசெய்யப்பட்டது';

  @override
  String get enRouteOpportunities => 'வழியில் வாய்ப்புகள்';

  @override
  String get pickupNearbyLoads => 'அருகிலுள்ள சரக்குகளை எடு';

  @override
  String get marketplaceLoads => 'சந்தை சரக்குகள்';

  @override
  String get availableLoadsYouCanBidFor => 'நீங்கள் ஏலம் கட்டக்கூடிய கிடைக்கும் சரக்குகள்';

  @override
  String get couldNotLoadMarketplace => 'சந்தையை ஏற்ற முடியவில்லை';

  @override
  String get pullToRefresh => 'புதுப்பிக்க இழுக்கவும்';

  @override
  String get noLoadsAvailable => 'சரக்குகள் கிடைக்கவில்லை';

  @override
  String get bidSubmitted => 'ஏலம் வெற்றிகரமாக சமர்ப்பிக்கப்பட்டது';

  @override
  String get failedToSubmitBid => 'ஏலத்தை சமர்ப்பிக்க முடியவில்லை';

  @override
  String get thisLoadIsMissingId => 'இந்த சரக்கிற்கு ஒரு அடையாளம் இல்லை';

  @override
  String get recommendedReturnLoads => 'பரிந்துரைக்கப்பட்ட திரும்ப சரக்குகள்';

  @override
  String get recommendedForYou => 'உங்களுக்காக பரிந்துரைக்கப்பட்டது';

  @override
  String get matchScore => 'பொருத்த மதிப்பீடு';

  @override
  String get bestMatch => 'சிறந்த பொருத்தம்';

  @override
  String get noRecommendations => 'திரும்ப சரக்கு பரிந்துரைகள் கிடைக்கவில்லை';

  @override
  String get couldNotLoadRecommendations => 'பரிந்துரைகளை ஏற்ற முடியவில்லை';

  @override
  String get noActiveTripForRecommendations => 'திரும்ப சரக்கு பரிந்துரைகளைக் காண ஒரு பயணத்தை நிறைவு செய்யுங்கள்';

  @override
  String get detourDistance => 'சுற்றுவழி';

  @override
  String get bidOnLoad => 'ஏலம்';

  @override
  String get updateBid => 'ஏலத்தைப் புதுப்பி';

  @override
  String get placeYourBid => 'உங்கள் ஏலத்தை வையுங்கள்';

  @override
  String get bidAmount => 'ஏலத் தொகை';

  @override
  String get submitBid => 'ஏலத்தைச் சமர்ப்';

  @override
  String get enterValidBid => 'சரியான ஏலத் தொகையை உள்ளிடவும்';

  @override
  String get unableToOpen => 'அறிவிப்பைத் திறக்க முடியவில்லை';

  @override
  String get withdraw => 'பணம் எடு';

  @override
  String get withdrawFunds => 'நிதிகளை எடு';

  @override
  String get availableBalance => 'கிடைக்கும் இருப்பு';

  @override
  String get enterAmount => 'தொகையை உள்ளிடவும்';

  @override
  String get amountRequired => 'தொகை தேவை';

  @override
  String get enterValidAmount => 'தயவுசெய்து சரியான தொகையை உள்ளிடவும்';

  @override
  String get amountMustBePositive => 'தொகை பூஜ்யத்தை விட அதிகமாக இருக்க வேண்டும்';

  @override
  String get insufficientBalance => 'போதுமான இருப்பு இல்லை';

  @override
  String get max => 'அதிகபட்சம்';

  @override
  String get withdrawalSuccessful => 'பணம் எடுப்பு வெற்றிகரமாக முடிந்தது';

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

  @override
  String get language => 'மொழி';

  @override
  String get english => 'ஆங்கிலம்';

  @override
  String get hindi => 'இந்தி';

  @override
  String get tamil => 'தமிழ்';
}
