// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Marathi (`mr`).
class AppLocalizationsMr extends AppLocalizations {
  AppLocalizationsMr([String locale = 'mr']) : super(locale);

  @override
  String get appTitle => 'Truxify';

  @override
  String get loginTitle => 'Truxify मध्ये स्वागत आहे';

  @override
  String get bookLoadButton => 'लोड बुक करा';

  @override
  String get loadingText => 'लोड होत आहे...';

  @override
  String comingSoon(String title) {
    return '$title लवकरच येत आहे';
  }

  @override
  String greetingMessage(String greeting, String displayName) {
    return '$greeting, $displayName 👋';
  }

  @override
  String get noActiveShipments => 'सक्रिय शिपमेंट नाही';

  @override
  String get routeHistoryComingSoon => 'मार्ग इतिहास लवकरच येत आहे';

  @override
  String get walletAddressUpdated => 'वॉलेट पत्ता अद्ययावत केला';

  @override
  String get polygonWalletAddress => 'पॉलिगॉन वॉलेट पत्ता';

  @override
  String get saveWalletAddress => 'वॉलेट पत्ता जतन करा';

  @override
  String error(String errorMsg) {
    return 'त्रुटी: $errorMsg';
  }

  @override
  String get lightTheme => 'प्रकाश';

  @override
  String get darkTheme => 'अंधार';

  @override
  String get retry => 'पुन्हा प्रयत्न करा';

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
  String get welcomeBack => 'पुन्हा स्वागत आहे';

  @override
  String get signInSubtitle => 'सुरू ठेवण्यासाठी साइन इन करा';

  @override
  String get phoneNumber => 'फोन नंबर';

  @override
  String get sendOtp => 'OTP पाठवा';

  @override
  String get sendingOtp => 'OTP पाठवत आहे...';

  @override
  String get verifyingOtp => 'तपासत आहे...';

  @override
  String get verifyOtp => 'OTP तपासा';

  @override
  String get loginWithBiometrics => 'बायोमेट्रिक्ससह लॉगिन करा';

  @override
  String get biometricsNotSupported => 'या उपकरणावर बायोमेट्रिक्स समर्थित नाही';

  @override
  String get biometricAuthSuccessful => 'बायोमेट्रिक प्रमाणीकरण यशस्वी';

  @override
  String get pleaseEnterPhone => 'कृपया तुमचा फोन नंबर प्रविष्ट करा';

  @override
  String get phoneDigitsOnly => 'फोन नंबरमध्ये केवळ अंक असावेत';

  @override
  String phoneMustBeExactDigits(int digitCount) {
    return 'फोन नंबर नेमके $digitCount अंकांचा असावा';
  }

  @override
  String get phoneMustBeDigits => 'फोन नंबरमध्ये केवळ अंक असावेत';

  @override
  String get verificationFailed => 'तपासणी अयशस्वी. कृपया पुन्हा प्रयत्न करा.';

  @override
  String get phoneVerificationFailed => 'फोन तपासणी अयशस्वी. कृपया पुन्हा प्रयत्न करा.';

  @override
  String get autoVerificationFailed => 'स्वयं-तपासणी अयशस्वी. कृपया OTP मॅन्युअली प्रविष्ट करा.';

  @override
  String get failedToSendOtp => 'OTP पाठवण्यात अयशस्वी. कृपया पुन्हा प्रयत्न करा.';

  @override
  String get enterOtp => 'OTP प्रविष्ट करा';

  @override
  String sentTo(String phoneNumber) {
    return '$phoneNumber वर पाठवले';
  }

  @override
  String get invalidOtp => 'अवैध OTP. कृपया तपासा आणि पुन्हा प्रयत्न करा.';

  @override
  String get verificationSessionExpired => 'तपासणी सत्र कालबाह्य झाले. कृपया नवीन OTP विनंती करा.';

  @override
  String get invalidVerificationCode => 'अवैध तपासणी कोड.';

  @override
  String get otpExpired => 'OTP कालबाह्य झाला. कृपया नवीन विनंती करा.';

  @override
  String get home => 'मुख्यपृष्ठ';

  @override
  String get findTrucks => 'ट्रक शोधा';

  @override
  String get orders => 'ऑर्डर';

  @override
  String get profile => 'प्रोफाइल';

  @override
  String get activeShipments => 'सक्रिय शिपमेंट';

  @override
  String get seeAll => 'सर्व पहा';

  @override
  String get bookATruck => 'ट्रक बुक करा';

  @override
  String get active => 'सक्रिय';

  @override
  String get moreStats => 'अधिक आकडेवारी';

  @override
  String get savings => 'बचत';

  @override
  String get totalShipments => 'एकूण शिपमेंट';

  @override
  String get yourUsualRoutes => 'तुमचे नेहमीचे मार्ग';

  @override
  String get lastTruckLocation => 'शेवटचे ट्रक स्थान';

  @override
  String get couldNotLoadData => 'माहिती लोड करता आली नाही';

  @override
  String get mlPoweredMatching => 'ML-आधारित जुळवाजुळव';

  @override
  String get route => 'मार्ग';

  @override
  String get pickupLocation => 'पिकअप स्थान';

  @override
  String get dropLocation => 'ड्रॉप स्थान';

  @override
  String get date => 'तारीख';

  @override
  String get time => 'वेळ';

  @override
  String get goodsDetails => 'माल माहिती';

  @override
  String get goodsType => 'माल प्रकार';

  @override
  String get weightTonnes => 'वजन (टन)';

  @override
  String get lengthFt => 'लांबी (फूट)';

  @override
  String get widthFt => 'रुंदी (फूट)';

  @override
  String get heightFt => 'उंची (फूट)';

  @override
  String get stackable => 'स्टॅक करता येणारे';

  @override
  String get fragile => 'जाळवान';

  @override
  String get specialRequirements => 'विशेष आवश्यकता';

  @override
  String get estimatedPriceRange => 'अंदाजे किंमत श्रेणी';

  @override
  String get stableThisWeek => 'या आठवड्यात स्थिर';

  @override
  String get estimatingPrice => 'किंमत अंदाजत आहे...';

  @override
  String get estimateUnavailable => 'अंदाज उपलब्ध नाही';

  @override
  String get enterRouteDetails => 'सुरू करण्यासाठी मार्ग माहिती प्रविष्ट करा';

  @override
  String get basedOnCurrentDemand => 'सध्याच्या मागावर आधारित';

  @override
  String get filterTrucks => 'ट्रक फिल्टर करा';

  @override
  String get truckType => 'ट्रक प्रकार';

  @override
  String get capacityTonnes => 'क्षमता (टन)';

  @override
  String get materialType => 'साहित्य प्रकार';

  @override
  String get today => 'आज';

  @override
  String get tomorrow => 'उद्या';

  @override
  String get selectPickupOnMap => 'नकाशावर पिकअप निवडा';

  @override
  String get selectDropOnMap => 'नकाशावर ड्रॉप निवडा';

  @override
  String get temperatureControl => 'तापमान नियंत्रण';

  @override
  String get waterproofCover => 'पाण्याप्रतिरोधक झाकण';

  @override
  String get loadingHelp => 'लोडिंग मदत';

  @override
  String get loadingHelpNeeded => 'लोडिंग मदत आवश्यक';

  @override
  String get other => 'इतर';

  @override
  String get describeYourGoods => 'तुमचा माल वर्णवा...';

  @override
  String get activeTab => 'सक्रिय';

  @override
  String get historyTab => 'इतिहास';

  @override
  String get searchOrdersHint => 'ऑर्डर शोधा...';

  @override
  String get noActiveOrders => 'सक्रिय ऑर्डर नाहीत';

  @override
  String get noHistoryOrders => 'ऑर्डर इतिहास नाही';

  @override
  String get offlineMode => 'ऑफलाइन मोड';

  @override
  String lastUpdated(String timeAgo) {
    return 'शेवटचे अद्ययावत $timeAgo';
  }

  @override
  String get driverAssigned => 'चालक नियुक्त';

  @override
  String get inTransit => 'वाहतूकमध्ये';

  @override
  String get paymentReleased => 'पेमेंट बऱ्या झाले';

  @override
  String get delivered => 'वितरित';

  @override
  String get cancelled => 'रद्द';

  @override
  String get pending => 'प्रलंबित';

  @override
  String get account => 'खाते';

  @override
  String get preferences => 'प्राधान्ये';

  @override
  String get paymentMethods => 'पेमेंट पद्धती';

  @override
  String get myDocuments => 'माझे कागदपत्रे';

  @override
  String get savedAddresses => 'जतन केलेले पत्ते';

  @override
  String get walletAddressLabel => 'वॉलेट पत्ता';

  @override
  String get notSet => 'सेट केलेले नाही';

  @override
  String get language => 'भाषा';

  @override
  String get helpSupport => 'मदत आणि सहाय्य';

  @override
  String get aboutTruxify => 'Truxify बद्दल';

  @override
  String get logout => 'लॉगआउट';

  @override
  String offlineModeLabel(String timeAgo) {
    return 'ऑफलाइन मोड (शेवटचे अद्ययावत $timeAgo)';
  }

  @override
  String get ordersLabel => 'ऑर्डर';

  @override
  String get savedLabel => 'जतन केलेले';

  @override
  String get co2Label => 'CO₂ वाचवले';

  @override
  String get editProfile => 'प्रोफाइल संपादित करा';

  @override
  String get fullName => 'पूर्ण नाव';

  @override
  String get companyName => 'कंपनीचे नाव';

  @override
  String get phone => 'फोन';

  @override
  String get enterFullName => 'तुमचे पूर्ण नाव प्रविष्ट करा';

  @override
  String get enterCompanyName => 'तुमच्या कंपनीचे नाव प्रविष्ट करा';

  @override
  String get enterPhoneNumber => 'तुमचा फोन नंबर प्रविष्ट करा';

  @override
  String get nameIsRequired => 'नाव आवश्यक आहे';

  @override
  String get companyNameIsRequired => 'कंपनीचे नाव आवश्यक आहे';

  @override
  String get phoneNumberIsRequired => 'फोन नंबर आवश्यक आहे';

  @override
  String get saving => 'जतन करत आहे...';

  @override
  String get saveChanges => 'बदल जतन करा';

  @override
  String get profileUpdatedSuccessfully => 'प्रोफाइल यशस्वीरित्या अद्ययावत झाली';

  @override
  String get failedToLoadProfile => 'प्रोफाइल लोड करण्यात अयशस्वी';

  @override
  String get failedToUpdateProfile => 'प्रोफाइल अद्ययावत करण्यात अयशस्वी';

  @override
  String get shareTracking => 'ट्रॅकिंग शेअर करा';

  @override
  String get trackingLinkGenerated => 'ट्रॅकिंग लिंक तयार झाला';

  @override
  String get unableToShare => 'शेअर करता आले नाही';

  @override
  String get linkExpired => 'हा ट्रॅकिंग लिंक कालबाह्य झाला आहे किंवा तो वैध नाही.';

  @override
  String get trackingRevoked => 'सर्व ट्रॅकिंग लिंक रद्द करण्यात आले आहेत.';

  @override
  String get copyLink => 'लिंक कॉपी करा';

  @override
  String get shareMessage => 'तुमचे शिपमेंट Truxify वर ट्रॅक करा';

  @override
  String get orderNotFound => 'ऑर्डर सापडली नाही';

  @override
  String get notification => 'सूचना';

  @override
  String get unableToOpen => 'सूचना उघडता आली नाही';

  @override
  String get downloadInvoice => 'बीजक डाउनलोड करा';

  @override
  String get generatingInvoice => 'बीजक तयार करत आहे...';

  @override
  String get invoiceReady => 'बीजक तयार आहे';

  @override
  String get shareInvoice => 'बीजक शेअर करा';

  @override
  String get printInvoice => 'बीजक प्रिंट करा';

  @override
  String get downloadFailed => 'डाउनलोड अयशस्वी';

  @override
  String get networkError => 'Network error. Please check your connection.';
}
