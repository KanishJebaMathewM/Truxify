// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Hindi (`hi`).
class AppLocalizationsHi extends AppLocalizations {
  AppLocalizationsHi([String locale = 'hi']) : super(locale);

  @override
  String get appTitle => 'ट्रक्सिफाई ड्राइवर';

  @override
  String get loadingText => 'लोड हो रहा है...';

  @override
  String get retry => 'पुनः प्रयास करें';

  @override
  String get error => 'त्रुटि';

  @override
  String get cancel => 'रद्द करें';

  @override
  String get save => 'सहेजें';

  @override
  String get close => 'बंद करें';

  @override
  String get apply => 'लागू करें';

  @override
  String get reset => 'रीसेट करें';

  @override
  String get search => 'खोजें';

  @override
  String get welcomeDriver => 'स्वागत है, ड्राइवर!';

  @override
  String get logInToStartEarning => 'कमाई शुरू करने के लिए लॉग इन करें';

  @override
  String get phoneNumber => 'फ़ोन नंबर';

  @override
  String get sendOtp => 'OTP भेजें';

  @override
  String get sending => 'भेजा जा रहा है...';

  @override
  String get verificationFailed => 'सत्यापन विफल';

  @override
  String get pleaseEnterPhone => 'कृपया अपना फ़ोन नंबर दर्ज करें';

  @override
  String get enterValidPhone => 'कृपया एक वैध फ़ोन नंबर दर्ज करें';

  @override
  String phoneMustBeExactDigits(int digitCount) {
    return 'फ़ोन नंबर ठीक $digitCount अंकों का होना चाहिए';
  }

  @override
  String get phoneMustBeDigits => 'फ़ोन नंबर में केवल अंक होने चाहिए';

  @override
  String get autoVerificationFailed => 'स्वतः सत्यापन विफल। कृपया मैन्युअल रूप से OTP दर्ज करें।';

  @override
  String get protectedDriverAccess => 'यह क्षेत्र केवल पंजीकृत ड्राइवरों के लिए प्रतिबंधित है।';

  @override
  String get verifyOtp => 'OTP सत्यापित करें';

  @override
  String get enterOtp => 'अपने फ़ोन पर भेजा गया OTP दर्ज करें';

  @override
  String sentTo(String phoneNumber) {
    return '$phoneNumber पर भेजा गया';
  }

  @override
  String get invalidOtp => 'अमान्य OTP। कृपया पुनः प्रयास करें।';

  @override
  String get codeExpired => 'OTP की समय सीमा समाप्त हो गई है। कृपया एक नया अनुरोध करें।';

  @override
  String get verificationFailedMsg => 'सत्यापन विफल। कृपया पुनः प्रयास करें।';

  @override
  String get couldNotVerifyOtp => 'OTP सत्यापित नहीं हो सका। कृपया पुनः प्रयास करें।';

  @override
  String get verifying => 'सत्यापित हो रहा है...';

  @override
  String get home => 'होम';

  @override
  String get trips => 'यात्राएँ';

  @override
  String get earnings => 'कमाई';

  @override
  String get profile => 'प्रोफ़ाइल';

  @override
  String get offlineUsingCachedData => 'आप ऑफ़लाइन हैं। कैश किया गया डेटा उपयोग हो रहा है।';

  @override
  String get newLoadAvailable => 'नया लोड उपलब्ध है!';

  @override
  String get view => 'देखें';

  @override
  String get navigationActive => 'नेविगेशन सक्रिय';

  @override
  String headingTo(String destination) {
    return '$destination की ओर जा रहे हैं';
  }

  @override
  String get locating => 'आपको खोजा जा रहा है...';

  @override
  String get locationUnavailable => 'स्थान उपलब्ध नहीं है';

  @override
  String get currentLocation => 'वर्तमान स्थान';

  @override
  String get tapToRefresh => 'रिफ्रेश करने के लिए टैप करें';

  @override
  String get fetchingLocation => 'आपका स्थान प्राप्त किया जा रहा है...';

  @override
  String get whereAreYouHeading => 'आप कहाँ जा रहे हैं?';

  @override
  String get onlineAndReady => 'ऑनलाइन और तैयार';

  @override
  String get offline => 'ऑफ़लाइन';

  @override
  String get offlineGoOnline => 'आप ऑफ़लाइन हैं। लोड प्राप्त करने के लिए ऑनलाइन हो जाएँ।';

  @override
  String get radarActiveFetching => 'रडार सक्रिय — आस-पास के लोड प्राप्त किए जा रहे हैं...';

  @override
  String get radarActiveLooking => 'रडार सक्रिय — आपके निकट लोड खोजे जा रहे हैं।';

  @override
  String get todayPay => 'आज की कमाई';

  @override
  String get shiftHours => 'शिफ्ट घंटे';

  @override
  String get rating => 'रेटिंग';

  @override
  String get metricsUnavailable => 'मेट्रिक्स उपलब्ध नहीं हैं';

  @override
  String get noDestinationAvailable => 'कोई गंतव्य निर्धारित नहीं है';

  @override
  String get currentLocationUnavailable => 'वर्तमान स्थान उपलब्ध नहीं है';

  @override
  String get unableToOpenGoogleMaps => 'Google Maps खोलने में असमर्थ';

  @override
  String get failedToGenerateRoute => 'मार्ग बनाने में विफल';

  @override
  String get enRoute => 'मार्ग में';

  @override
  String get assignedLoad => 'नियुक्त लोड';

  @override
  String get distance => 'दूरी';

  @override
  String get estDuration => 'अनुमानित अवधि';

  @override
  String get estPayout => 'अनुमानित भुगतान';

  @override
  String get slideToCompleteTrip => 'यात्रा पूरी करने के लिए स्लाइड करें';

  @override
  String get slideToStartTrip => 'यात्रा शुरू करने के लिए स्लाइड करें';

  @override
  String get cancelAssignment => 'नियुक्ति रद्द करें';

  @override
  String tripCompletedNetEarnings(String amount) {
    return 'यात्रा पूरी! शुद्ध कमाई: $amount';
  }

  @override
  String get failedToCompleteTrip => 'यात्रा पूरी करने में विफल';

  @override
  String get failedToStartTrip => 'यात्रा शुरू करने में विफल';

  @override
  String get tripCompleted => 'यात्रा पूर्ण';

  @override
  String get pleaseGoOnline => 'कृपया पहले ऑनलाइन हो जाएँ';

  @override
  String get noDestinationAvailable2 => 'कोई गंतव्य उपलब्ध नहीं है। कृपया गंतव्य निर्धारित करें।';

  @override
  String get locationPermissionRequired => 'स्थान अनुमति आवश्यक है';

  @override
  String get locationAccessDenied => 'स्थान पहुँच अस्वीकृत';

  @override
  String get locationPermDenied => 'स्थान अनुमति स्थायी रूप से अस्वीकृत। कृपया सेटिंग्स में सक्षम करें।';

  @override
  String get openSettings => 'सेटिंग्स खोलें';

  @override
  String get editProfile => 'प्रोफ़ाइल संपादित करें';

  @override
  String get fullNames => 'पूरा नाम';

  @override
  String get phoneNumbers => 'फ़ोन नंबर';

  @override
  String get emailAddress => 'ईमेल पता';

  @override
  String get vehicleRegistrationNumber => 'वाहन पंजीकरण संख्या';

  @override
  String get saveChanges => 'परिवर्तन सहेजें';

  @override
  String get profileUpdatedSuccessfully => 'प्रोफ़ाइल सफलतापूर्वक अपडेट हो गई';

  @override
  String get selectLanguage => 'भाषा चुनें';

  @override
  String get applyLanguage => 'भाषा लागू करें';

  @override
  String get languageSwitched => 'भाषा सफलतापूर्वक बदल दी गई';

  @override
  String get polygonWalletAddress => 'पॉलीगॉन वॉलेट पता';

  @override
  String get saveWalletAddress => 'वॉलेट पता सहेजें';

  @override
  String get walletAddressUpdated => 'वॉलेट पता अपडेट हो गया';

  @override
  String get failedToUpdateWallet => 'वॉलेट पता अपडेट करने में विफल';

  @override
  String get helpSupport => 'सहायता और समर्थन';

  @override
  String get browseFAQs => 'अक्सर पूछे जाने वाले प्रश्न देखें';

  @override
  String get instantAnswers => 'सामान्य प्रश्नों के तुरंत उत्तर प्राप्त करें';

  @override
  String get aboutTruxifyDriverApp => 'ट्रक्सिफाई ड्राइवर ऐप के बारे में';

  @override
  String get truxifyDescription => 'ट्रक्सिफाई एक ट्रक लॉजिस्टिक्स प्लेटफ़ॉर्म है जो पूर्वी अफ्रीका में ड्राइवरों को लोड से जोड़ता है।';

  @override
  String get documents => 'दस्तावेज़';

  @override
  String get driverLicensePermitPapers => 'ड्राइवर लाइसेंस और परमिट पेपर';

  @override
  String get notifications => 'सूचनाएँ';

  @override
  String get viewTripAlerts => 'यात्रा अलर्ट देखें';

  @override
  String get walletAddress => 'वॉलेट पता';

  @override
  String get notSet => 'सेट नहीं है';

  @override
  String get languageLabel => 'भाषा';

  @override
  String get helpAndSupport247 => 'सहायता और समर्थन (24/7)';

  @override
  String get versionAndAppInfo => 'संस्करण और ऐप जानकारी';

  @override
  String get logout => 'लॉगआउट';

  @override
  String get logoutFailed => 'लॉगआउट विफल। कृपया पुनः प्रयास करें।';

  @override
  String get myTrips => 'मेरी यात्राएँ';

  @override
  String get marketplace => 'मार्केटप्लेस';

  @override
  String get sortTrips => 'यात्राएँ क्रमबद्ध करें';

  @override
  String get newestFirst => 'नवीनतम पहले';

  @override
  String get oldestFirst => 'पुराने पहले';

  @override
  String get highestEarnings => 'सर्वोच्च कमाई';

  @override
  String get lowestEarnings => 'न्यूनतम कमाई';

  @override
  String get byStatus => 'स्थिति के अनुसार';

  @override
  String get totalTrips => 'कुल यात्राएँ';

  @override
  String get totalEarned => 'कुल कमाई';

  @override
  String get completion => 'पूर्णता';

  @override
  String get all => 'सभी';

  @override
  String get active2 => 'सक्रिय';

  @override
  String get completed2 => 'पूर्ण';

  @override
  String get cancelled2 => 'रद्द';

  @override
  String get failedToLoadTrips => 'यात्राएँ लोड करने में विफल';

  @override
  String get pullDownToRetry => 'पुनः प्रयास के लिए नीचे खींचें';

  @override
  String get noTripsFound => 'कोई यात्रा नहीं मिली';

  @override
  String get deliveryStops => 'डिलीवरी स्टॉप';

  @override
  String get markCurrentStopCompleted => 'वर्तमान स्टॉप पूर्ण चिन्हित करें';

  @override
  String get activeStatus => 'सक्रिय';

  @override
  String get completedStatus => 'पूर्ण';

  @override
  String get cancelledStatus => 'रद्द';

  @override
  String get enRouteOpportunities => 'मार्ग में अवसर';

  @override
  String get pickupNearbyLoads => 'निकटवर्ती लोड उठाएँ';

  @override
  String get marketplaceLoads => 'मार्केटप्लेस लोड';

  @override
  String get availableLoadsYouCanBidFor => 'उपलब्ध लोड जिन पर आप बोली लगा सकते हैं';

  @override
  String get couldNotLoadMarketplace => 'मार्केटप्लेस लोड नहीं हो सका';

  @override
  String get pullToRefresh => 'रिफ्रेश के लिए खींचें';

  @override
  String get noLoadsAvailable => 'कोई लोड उपलब्ध नहीं है';

  @override
  String get bidSubmitted => 'बोली सफलतापूर्वक सबमिट हो गई';

  @override
  String get failedToSubmitBid => 'बोली सबमिट करने में विफल';

  @override
  String get thisLoadIsMissingId => 'इस लोड में ID गायब है';

  @override
  String get recommendedReturnLoads => 'सुझाए गए वापसी लोड';

  @override
  String get recommendedForYou => 'आपके लिए सुझाया गया';

  @override
  String get matchScore => 'मैच स्कोर';

  @override
  String get bestMatch => 'सर्वोत्तम मैच';

  @override
  String get noRecommendations => 'कोई वापसी लोड सिफारिश उपलब्ध नहीं है';

  @override
  String get couldNotLoadRecommendations => 'सिफारिशें लोड नहीं हो सकीं';

  @override
  String get noActiveTripForRecommendations => 'वापसी लोड सुझाव देखने के लिए यात्रा पूरी करें';

  @override
  String get detourDistance => 'डायवर्जन';

  @override
  String get bidOnLoad => 'बोली लगाएं';

  @override
  String get updateBid => 'बोली अपडेट करें';

  @override
  String get placeYourBid => 'अपनी बोली लगाएं';

  @override
  String get bidAmount => 'बोली राशि';

  @override
  String get submitBid => 'बोली सबमिट करें';

  @override
  String get enterValidBid => 'एक मान्य बोली राशि दर्ज करें';
  String get unableToOpen => 'सूचना खोलने में असमर्थ';
  String get withdraw => 'निकालें';

  @override
  String get withdrawFunds => 'फंड निकालें';

  @override
  String get availableBalance => 'उपलब्ध शेष';

  @override
  String get enterAmount => 'राशि दर्ज करें';

  @override
  String get amountRequired => 'राशि आवश्यक है';

  @override
  String get enterValidAmount => 'कृपया एक वैध राशि दर्ज करें';

  @override
  String get amountMustBePositive => 'राशि शून्य से अधिक होनी चाहिए';

  @override
  String get insufficientBalance => 'अपर्याप्त शेष';

  @override
  String get max => 'अधिकतम';

  @override
  String get withdrawalSuccessful => 'निकासी सफल';
}
