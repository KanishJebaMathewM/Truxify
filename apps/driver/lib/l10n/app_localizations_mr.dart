// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Marathi (`mr`).
class AppLocalizationsMr extends AppLocalizations {
  AppLocalizationsMr([String locale = 'mr']) : super(locale);

  @override
  String get appTitle => 'ट्रक्सिफाय चालक';

  @override
  String get loadingText => 'लोड होत आहे...';

  @override
  String get retry => 'पुन्हा प्रयत्न करा';

  @override
  String get error => 'त्रुटी';

  @override
  String get cancel => 'रद्द करा';

  @override
  String get save => 'जतन करा';

  @override
  String get close => 'बंद करा';

  @override
  String get apply => 'लागू करा';

  @override
  String get reset => 'रीसेट करा';

  @override
  String get search => 'शोधा';

  @override
  String get welcomeDriver => 'स्वागत आहे, चालक!';

  @override
  String get logInToStartEarning => 'कमाई सुरू करण्यासाठी लॉग इन करा';

  @override
  String get phoneNumber => 'फोन नंबर';

  @override
  String get sendOtp => 'OTP पाठवा';

  @override
  String get sending => 'पाठवत आहे...';

  @override
  String get verificationFailed => 'पडताळणी अयशस्वी';

  @override
  String get pleaseEnterPhone => 'कृपया तुमचा फोन नंबर प्रविष्ट करा';

  @override
  String get enterValidPhone => 'कृपया वैध फोन नंबर प्रविष्ट करा';

  @override
  String phoneMustBeExactDigits(int digitCount) {
    return 'फोन नंबर अचूकपणे $digitCount अंकांचा असणे आवश्यक आहे';
  }

  @override
  String get phoneMustBeDigits => 'फोन नंबरात केवळ अंक असणे आवश्यक आहे';

  @override
  String get autoVerificationFailed => 'स्वयं-पडताळणी अयशस्वी. कृपया OTP मॅन्युअली प्रविष्ट करा.';

  @override
  String get protectedDriverAccess => 'हा भाग नोंदणीकृत चालकांपुरती जमावून ठेवलेला आहे.';

  @override
  String get verifyOtp => 'OTP पडताळा';

  @override
  String get enterOtp => 'तुमच्या फोनवर पाठवलेला OTP प्रविष्ट करा';

  @override
  String sentTo(String phoneNumber) {
    return '$phoneNumber वर पाठवले';
  }

  @override
  String get invalidOtp => 'अवैध OTP. कृपया पुन्हा प्रयत्न करा.';

  @override
  String get codeExpired => 'OTP कालबाह्य झाला आहे. कृपया नवीन मागवा.';

  @override
  String get verificationFailedMsg => 'पडताळणी अयशस्वी. कृपया पुन्हा प्रयत्न करा.';

  @override
  String get couldNotVerifyOtp => 'OTP पडताळणी शक्य नाही. कृपया पुन्हा प्रयत्न करा.';

  @override
  String get verifying => 'पडताळत आहे...';

  @override
  String get home => 'मुख्यपृष्ठ';

  @override
  String get trips => 'प्रवास';

  @override
  String get earnings => 'कमाई';

  @override
  String get profile => 'प्रोफाइल';

  @override
  String get offlineUsingCachedData => 'तुम्ही ऑफलाइन आहात. कॅशे केलेला डेटा वापरत आहे.';

  @override
  String get newLoadAvailable => 'नवीन माल उपलब्ध!';

  @override
  String get view => 'पहा';

  @override
  String get navigationActive => 'नेव्हिगेशन सक्रिय';

  @override
  String headingTo(String destination) {
    return '$destination जात आहोत';
  }

  @override
  String get locating => 'तुम्हाला शोधत आहे...';

  @override
  String get locationUnavailable => 'स्थान उपलब्ध नाही';

  @override
  String get currentLocation => 'सध्याचे स्थान';

  @override
  String get tapToRefresh => 'रिफ्रेश करण्यासाठी टॅप करा';

  @override
  String get fetchingLocation => 'तुमचे स्थान मिळवत आहे...';

  @override
  String get whereAreYouHeading => 'तुम्ही कुठे जात आहात?';

  @override
  String get onlineAndReady => 'ऑनलाइन आणि तयार';

  @override
  String get offline => 'ऑफलाइन';

  @override
  String get offlineGoOnline => 'तुम्ही ऑफलाइन आहात. माल मिळवण्यासाठी ऑनलाइन व्हा.';

  @override
  String get radarActiveFetching => 'रडार सक्रिय — जवळचा माल शोधत आहे...';

  @override
  String get radarActiveLooking => 'रडार सक्रिय — तुमच्या जवळ माल शोधत आहे.';

  @override
  String get todayPay => 'आजची तगाई';

  @override
  String get shiftHours => 'शिफ्ट तास';

  @override
  String get rating => 'रेटिंग';

  @override
  String get metricsUnavailable => 'मेट्रिक्स उपलब्ध नाही';

  @override
  String get noDestinationAvailable => 'गंतव्य निर्धारित नाही';

  @override
  String get currentLocationUnavailable => 'सध्याचे स्थान उपलब्ध नाही';

  @override
  String get unableToOpenGoogleMaps => 'Google Maps उघडता येत नाही';

  @override
  String get failedToGenerateRoute => 'मार्ग तयार करण्यात अयशस्वी';

  @override
  String get enRoute => 'मार्गावर';

  @override
  String get assignedLoad => 'नियुक्त माल';

  @override
  String get distance => 'अंतर';

  @override
  String get estDuration => 'अंदाजे कालावधी';

  @override
  String get estPayout => 'अंदाजे तगाई';

  @override
  String get slideToCompleteTrip => 'प्रवास पूर्ण करण्यासाठी स्लाइड करा';

  @override
  String get slideToStartTrip => 'प्रवास सुरू करण्यासाठी स्लाइड करा';

  @override
  String get cancelAssignment => 'नियुक्ती रद्द करा';

  @override
  String tripCompletedNetEarnings(String amount) {
    return 'प्रवास पूर्ण झाला! शुद्ध कमाई: $amount';
  }

  @override
  String get failedToCompleteTrip => 'प्रवास पूर्ण करण्यात अयशस्वी';

  @override
  String get failedToStartTrip => 'प्रवास सुरू करण्यात अयशस्वी';

  @override
  String get tripCompleted => 'प्रवास पूर्ण झाला';

  @override
  String get pleaseGoOnline => 'कृपया प्रथम ऑनलाइन व्हा';

  @override
  String get noDestinationAvailable2 => 'गंतव्य उपलब्ध नाही. कृपया गंतव्य निर्धारित करा.';

  @override
  String get locationPermissionRequired => 'स्थान परवानगी आवश्यक आहे';

  @override
  String get locationAccessDenied => 'स्थान प्रवेश नाकारला';

  @override
  String get locationPermDenied => 'स्थान परवानगी कायमच्या नाकारली. कृपया सेटिंग्जमध्ये सक्षम करा.';

  @override
  String get openSettings => 'सेटिंग्ज उघडा';

  @override
  String get editProfile => 'प्रोफाइल संपादित करा';

  @override
  String get fullNames => 'पूर्ण नावे';

  @override
  String get phoneNumbers => 'फोन नंबर';

  @override
  String get emailAddress => 'ईमेल पत्ता';

  @override
  String get vehicleRegistrationNumber => 'वाहन नोंदणी क्रमांक';

  @override
  String get saveChanges => 'बदल जतन करा';

  @override
  String get profileUpdatedSuccessfully => 'प्रोफाइल यशस्वीरित्या अद्ययावत केली';

  @override
  String get selectLanguage => 'भाषा निवडा';

  @override
  String get applyLanguage => 'भाषा लागू करा';

  @override
  String get languageSwitched => 'भाषा यशस्वीरित्या बदलली';

  @override
  String get polygonWalletAddress => 'पॉलिगॉन वॉलेट पत्ता';

  @override
  String get saveWalletAddress => 'वॉलेट पत्ता जतन करा';

  @override
  String get walletAddressUpdated => 'वॉलेट पत्ता अद्ययावत केला';

  @override
  String get failedToUpdateWallet => 'वॉलेट पत्ता अद्ययावत करण्यात अयशस्वी';

  @override
  String get helpSupport => 'मदत आणि समर्थन';

  @override
  String get browseFAQs => 'वारंवार विचारले जाणारे प्रश्न पहा';

  @override
  String get instantAnswers => 'सामान्य प्रश्नांचे त्वरित उत्तरे मिळवा';

  @override
  String get aboutTruxifyDriverApp => 'ट्रक्सिफाय चालक अॅपबद्दल';

  @override
  String get truxifyDescription => 'ट्रक्सिफाय हे पूर्व आफ्रिकेतील चालकांना मालांशी जोडणारे ट्रक लॉजिस्टिक्स प्लॅटफॉर्म आहे.';

  @override
  String get documents => 'कागदपत्रे';

  @override
  String get driverLicensePermitPapers => 'चालक परवाना आणि परवानगी कागदपत्रे';

  @override
  String get notifications => 'सूचना';

  @override
  String get viewTripAlerts => 'प्रवास सूचना पहा';

  @override
  String get walletAddress => 'वॉलेट पत्ता';

  @override
  String get notSet => 'निर्धारित नाही';

  @override
  String get languageLabel => 'भाषा';

  @override
  String get helpAndSupport247 => 'मदत आणि समर्थन (24/7)';

  @override
  String get versionAndAppInfo => 'आवृत्ती आणि अॅप माहिती';

  @override
  String get logout => 'लॉगआउट';

  @override
  String get logoutFailed => 'लॉगआउट अयशस्वी. कृपया पुन्हा प्रयत्न करा.';

  @override
  String get myTrips => 'माझे प्रवास';

  @override
  String get marketplace => 'बाजारपेठ';

  @override
  String get sortTrips => 'प्रवास क्रमवारी लावा';

  @override
  String get newestFirst => 'नवीनतम प्रथम';

  @override
  String get oldestFirst => 'जुनातम प्रथम';

  @override
  String get highestEarnings => 'सर्वाधिक कमाई';

  @override
  String get lowestEarnings => 'कमीत कमी कमाई';

  @override
  String get byStatus => 'स्थितीनुसार';

  @override
  String get totalTrips => 'एकूण प्रवास';

  @override
  String get totalEarned => 'एकूण कमाई';

  @override
  String get completion => 'पूर्णत्व';

  @override
  String get all => 'सर्व';

  @override
  String get active2 => 'सक्रिय';

  @override
  String get completed2 => 'पूर्ण झालेले';

  @override
  String get cancelled2 => 'रद्द केलेले';

  @override
  String get failedToLoadTrips => 'प्रवास लोड करण्यात अयशस्वी';

  @override
  String get pullDownToRetry => 'पुन्हा प्रयत्न करण्यासाठी खाली ओढा';

  @override
  String get noTripsFound => 'प्रवास सापडले नाहीत';

  @override
  String get deliveryStops => 'डिलिव्हरी थांबे';

  @override
  String get markCurrentStopCompleted => 'सध्याचे थांब पूर्ण म्हणून चिन्हांकित करा';

  @override
  String get activeStatus => 'सक्रिय';

  @override
  String get completedStatus => 'पूर्ण झालेले';

  @override
  String get cancelledStatus => 'रद्द केलेले';

  @override
  String get enRouteOpportunities => 'मार्गावरील संधी';

  @override
  String get pickupNearbyLoads => 'जवळचा माल उचला';

  @override
  String get marketplaceLoads => 'बाजारपेठेतील माल';

  @override
  String get availableLoadsYouCanBidFor => 'तुम्ही बोली लावू शकता ते उपलब्ध माल';

  @override
  String get couldNotLoadMarketplace => 'बाजारपेठ लोड करता आली नाही';

  @override
  String get pullToRefresh => 'रिफ्रेश करण्यासाठी ओढा';

  @override
  String get noLoadsAvailable => 'माल उपलब्ध नाही';

  @override
  String get bidSubmitted => 'बोली यशस्वीरित्या सबमिट केली';

  @override
  String get failedToSubmitBid => 'बोली सबमिट करण्यात अयशस्वी';

  @override
  String get thisLoadIsMissingId => 'या मालाला ID गरक आहे';

  @override
  String get recommendedReturnLoads => 'शिफारस केलेले परतील माल';

  @override
  String get recommendedForYou => 'तुमच्यासाठी शिफारस केलेले';

  @override
  String get matchScore => 'जुळवा स्कोअर';

  @override
  String get bestMatch => 'सर्वोत्तम जुळवा';

  @override
  String get noRecommendations => 'परतील माल शिफारशी उपलब्ध नाहीत';

  @override
  String get couldNotLoadRecommendations => 'शिफारशी लोड करता आल्या नाहीत';

  @override
  String get noActiveTripForRecommendations => 'परतील माल सूचना पाहण्यासाठी एक प्रवास पूर्ण करा';

  @override
  String get detourDistance => 'विचलन';

  @override
  String get bidOnLoad => 'बोली';

  @override
  String get updateBid => 'बोली अद्ययावत करा';

  @override
  String get placeYourBid => 'तुमची बोली लावा';

  @override
  String get bidAmount => 'बोली रक्कम';

  @override
  String get submitBid => 'बोली सबमिट करा';

  @override
  String get enterValidBid => 'वैध बोली रक्कम प्रविष्ट करा';

  @override
  String get unableToOpen => 'सूचना उघडता येत नाही';

  @override
  String get withdraw => 'पैसे काढा';

  @override
  String get withdrawFunds => 'पैसे काढा';

  @override
  String get availableBalance => 'उपलब्ध शिल्लक';

  @override
  String get enterAmount => 'रक्कम प्रविष्ट करा';

  @override
  String get amountRequired => 'रक्कम आवश्यक आहे';

  @override
  String get enterValidAmount => 'कृपया वैध रक्कम प्रविष्ट करा';

  @override
  String get amountMustBePositive => 'रक्कम शून्यापेक्षा अधिक असणे आवश्यक आहे';

  @override
  String get insufficientBalance => 'अपुरी शिल्लक';

  @override
  String get max => 'कमाल';

  @override
  String get withdrawalSuccessful => 'पैसे काढणे यशस्वी';

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
