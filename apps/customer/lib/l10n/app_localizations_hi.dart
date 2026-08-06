// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Hindi (`hi`).
class AppLocalizationsHi extends AppLocalizations {
  AppLocalizationsHi([String locale = 'hi']) : super(locale);

  @override
  String get appTitle => 'ट्रक्सिफाई';

  @override
  String get loginTitle => 'ट्रक्सिफाई में आपका स्वागत है';

  @override
  String get bookLoadButton => 'लोड बुक करें';

  @override
  String get loadingText => 'लोड हो रहा है...';

  @override
  String comingSoon(String title) {
    return '$title जल्द आ रहा है';
  }

  @override
  String greetingMessage(String greeting, String displayName) {
    return '$greeting, $displayName 👋';
  }

  @override
  String get noActiveShipments => 'कोई सक्रिय शिपमेंट नहीं';

  @override
  String get routeHistoryComingSoon => 'रूट इतिहास जल्द आ रहा है';

  @override
  String get walletAddressUpdated => 'वॉलेट पता अपडेट किया गया';

  @override
  String get polygonWalletAddress => 'पॉलीगॉन वॉलेट पता';

  @override
  String get saveWalletAddress => 'वॉलेट पता सहेजें';

  @override
  String error(String errorMsg) {
    return 'त्रुटि: $errorMsg';
  }

  @override
  String get lightTheme => 'हल्का';

  @override
  String get darkTheme => 'गहरा';

  @override
  String get retry => 'पुनः प्रयास करें';

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
  String get welcomeBack => 'वापसी पर स्वागत है';

  @override
  String get signInSubtitle => 'जारी रखने के लिए साइन इन करें';

  @override
  String get phoneNumber => 'फ़ोन नंबर';

  @override
  String get sendOtp => 'OTP भेजें';

  @override
  String get sendingOtp => 'OTP भेजा जा रहा है...';

  @override
  String get verifyingOtp => 'सत्यापन हो रहा है...';

  @override
  String get verifyOtp => 'OTP सत्यापित करें';

  @override
  String get loginWithBiometrics => 'बायोमेट्रिक्स से लॉगिन करें';

  @override
  String get biometricsNotSupported => 'इस डिवाइस पर बायोमेट्रिक्स समर्थित नहीं है';

  @override
  String get biometricAuthSuccessful => 'बायोमेट्रिक प्रमाणीकरण सफल';

  @override
  String get pleaseEnterPhone => 'कृपया अपना फ़ोन नंबर दर्ज करें';

  @override
  String get phoneDigitsOnly => 'फ़ोन नंबर में केवल अंक होने चाहिए';

  @override
  String phoneMustBeExactDigits(int digitCount) {
    return 'फ़ोन नंबर ठीक $digitCount अंकों का होना चाहिए';
  }

  @override
  String get phoneMustBeDigits => 'फ़ोन नंबर में केवल अंक होने चाहिए';

  @override
  String get verificationFailed => 'सत्यापन असफल। कृपया पुनः प्रयास करें।';

  @override
  String get phoneVerificationFailed => 'फ़ोन सत्यापन असफल। कृपया पुनः प्रयास करें।';

  @override
  String get autoVerificationFailed => 'स्वचालित सत्यापन असफल। कृपया OTP मैन्युअल रूप से दर्ज करें।';

  @override
  String get failedToSendOtp => 'OTP भेजने में असफल। कृपया पुनः प्रयास करें।';

  @override
  String get enterOtp => 'OTP दर्ज करें';

  @override
  String sentTo(String phoneNumber) {
    return '$phoneNumber पर भेजा गया';
  }

  @override
  String get invalidOtp => 'अमान्य OTP। कृपया जांचें और पुनः प्रयास करें।';

  @override
  String get verificationSessionExpired => 'सत्यापन सत्र समाप्त हो गया है। कृपया नया OTP अनुरोध करें।';

  @override
  String get invalidVerificationCode => 'अमान्य सत्यापन कोड।';

  @override
  String get otpExpired => 'OTP की समय सीमा समाप्त हो गई है। कृपया नया अनुरोध करें।';

  @override
  String get home => 'होम';

  @override
  String get findTrucks => 'ट्रक खोजें';

  @override
  String get orders => 'ऑर्डर';

  @override
  String get profile => 'प्रोफ़ाइल';

  @override
  String get activeShipments => 'सक्रिय शिपमेंट';

  @override
  String get seeAll => 'सभी देखें';

  @override
  String get bookATruck => 'ट्रक बुक करें';

  @override
  String get active => 'सक्रिय';

  @override
  String get moreStats => 'और आंकड़े';

  @override
  String get savings => 'बचत';

  @override
  String get totalShipments => 'कुल शिपमेंट';

  @override
  String get yourUsualRoutes => 'आपके नियमित मार्ग';

  @override
  String get lastTruckLocation => 'अंतिम ट्रक स्थान';

  @override
  String get couldNotLoadData => 'डेटा लोड नहीं हो सका';

  @override
  String get mlPoweredMatching => 'ML-संचालित मैचिंग';

  @override
  String get route => 'मार्ग';

  @override
  String get pickupLocation => 'पिकअप स्थान';

  @override
  String get dropLocation => 'ड्रॉप स्थान';

  @override
  String get date => 'तारीख';

  @override
  String get time => 'समय';

  @override
  String get goodsDetails => 'माल विवरण';

  @override
  String get goodsType => 'माल का प्रकार';

  @override
  String get weightTonnes => 'वज़न (टन)';

  @override
  String get lengthFt => 'लंबाई (फ़ीट)';

  @override
  String get widthFt => 'चौड़ाई (फ़ीट)';

  @override
  String get heightFt => 'ऊंचाई (फ़ीट)';

  @override
  String get stackable => 'स्टैकेबल';

  @override
  String get fragile => 'नाज़ुक';

  @override
  String get specialRequirements => 'विशेष आवश्यकताएं';

  @override
  String get estimatedPriceRange => 'अनुमानित मूल्य सीमा';

  @override
  String get stableThisWeek => 'इस सप्ताह स्थिर';

  @override
  String get estimatingPrice => 'मूल्य अनुमान लगाया जा रहा है...';

  @override
  String get estimateUnavailable => 'अनुमान उपलब्ध नहीं है';

  @override
  String get enterRouteDetails => 'शुरू करने के लिए मार्ग विवरण दर्ज करें';

  @override
  String get basedOnCurrentDemand => 'वर्तमान मांग के आधार पर';

  @override
  String get filterTrucks => 'ट्रक फ़िल्टर करें';

  @override
  String get truckType => 'ट्रक का प्रकार';

  @override
  String get capacityTonnes => 'क्षमता (टन)';

  @override
  String get materialType => 'सामग्री का प्रकार';

  @override
  String get today => 'आज';

  @override
  String get tomorrow => 'कल';

  @override
  String get selectPickupOnMap => 'मानचित्र पर पिकअप चुनें';

  @override
  String get selectDropOnMap => 'मानचित्र पर ड्रॉप चुनें';

  @override
  String get temperatureControl => 'तापमान नियंत्रण';

  @override
  String get waterproofCover => 'जलरोधक कवर';

  @override
  String get loadingHelp => 'लोडिंग सहायता';

  @override
  String get loadingHelpNeeded => 'लोडिंग सहायता आवश्यक';

  @override
  String get other => 'अन्य';

  @override
  String get describeYourGoods => 'अपने माल का वर्णन करें...';

  @override
  String get activeTab => 'सक्रिय';

  @override
  String get historyTab => 'इतिहास';

  @override
  String get searchOrdersHint => 'ऑर्डर खोजें...';

  @override
  String get noActiveOrders => 'कोई सक्रिय ऑर्डर नहीं';

  @override
  String get noHistoryOrders => 'कोई ऑर्डर इतिहास नहीं';

  @override
  String get offlineMode => 'ऑफ़लाइन मोड';

  @override
  String lastUpdated(String timeAgo) {
    return 'अंतिम अपडेट $timeAgo';
  }

  @override
  String get driverAssigned => 'ड्राइवर नियुक्त';

  @override
  String get inTransit => 'रास्ते में';

  @override
  String get paymentReleased => 'भुगतान जारी';

  @override
  String get delivered => 'वितरित';

  @override
  String get cancelled => 'रद्द';

  @override
  String get pending => 'लंबित';

  @override
  String get account => 'खाता';

  @override
  String get preferences => 'वरीयताएं';

  @override
  String get paymentMethods => 'भुगतान के तरीके';

  @override
  String get myDocuments => 'मेरे दस्तावेज़';

  @override
  String get savedAddresses => 'सहेजे गए पते';

  @override
  String get walletAddressLabel => 'वॉलेट पता';

  @override
  String get notSet => 'सेट नहीं है';

  @override
  String get language => 'भाषा';

  @override
  String get helpSupport => 'सहायता और समर्थन';

  @override
  String get aboutTruxify => 'ट्रक्सिफाई के बारे में';

  @override
  String get logout => 'लॉगआउट';

  @override
  String offlineModeLabel(String timeAgo) {
    return 'ऑफ़लाइन मोड (अंतिम अपडेट $timeAgo)';
  }

  @override
  String get ordersLabel => 'ऑर्डर';

  @override
  String get savedLabel => 'सहेजा गया';

  @override
  String get co2Label => 'CO₂ बचाया';

  @override
  String get editProfile => 'प्रोफ़ाइल संपादित करें';

  @override
  String get fullName => 'पूरा नाम';

  @override
  String get companyName => 'कंपनी का नाम';

  @override
  String get phone => 'फ़ोन';

  @override
  String get enterFullName => 'अपना पूरा नाम दर्ज करें';

  @override
  String get enterCompanyName => 'अपनी कंपनी का नाम दर्ज करें';

  @override
  String get enterPhoneNumber => 'अपना फ़ोन नंबर दर्ज करें';

  @override
  String get nameIsRequired => 'नाम आवश्यक है';

  @override
  String get companyNameIsRequired => 'कंपनी का नाम आवश्यक है';

  @override
  String get phoneNumberIsRequired => 'फ़ोन नंबर आवश्यक है';

  @override
  String get saving => 'सहेजा जा रहा है...';

  @override
  String get saveChanges => 'परिवर्तन सहेजें';

  @override
  String get profileUpdatedSuccessfully => 'प्रोफ़ाइल सफलतापूर्वक अपडेट हो गई';

  @override
  String get failedToLoadProfile => 'प्रोफ़ाइल लोड करने में असफल';

  @override
  String get failedToUpdateProfile => 'प्रोफ़ाइल अपडेट करने में असफल';

  @override
  String get shareTracking => 'ट्रैकिंग शेयर करें';

  @override
  String get trackingLinkGenerated => 'ट्रैकिंग लिंक बनाया गया';

  @override
  String get unableToShare => 'शेयर करने में असमर्थ';

  @override
  String get linkExpired => 'यह ट्रैकिंग लिंक समाप्त हो गया है या अब मान्य नहीं है।';

  @override
  String get trackingRevoked => 'सभी ट्रैकिंग लिंक रद्द कर दिए गए हैं।';

  @override
  String get copyLink => 'लिंक कॉपी करें';

  @override
  String get shareMessage => 'Truxify पर अपनी शिपमेंट ट्रैक करें';

  @override
  String get orderNotFound => 'ऑर्डर नहीं मिला';

  @override
  String get notification => 'सूचना';

  @override
  String get unableToOpen => 'सूचना खोलने में असमर्थ';

  @override
  String get downloadInvoice => 'इनवॉइस डाउनलोड करें';

  @override
  String get generatingInvoice => 'इनवॉइस बना रहे हैं...';

  @override
  String get invoiceReady => 'इनवॉइस तैयार है';

  @override
  String get shareInvoice => 'इनवॉइस साझा करें';

  @override
  String get printInvoice => 'इनवॉइस प्रिंट करें';

  @override
  String get downloadFailed => 'डाउनलोड असफल';

  @override
  String get networkError => 'Network error. Please check your connection.';
}
