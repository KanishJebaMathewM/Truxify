// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Truxify';

  @override
  String get loginTitle => 'Welcome to Truxify';

  @override
  String get bookLoadButton => 'Book a Load';

  @override
  String get loadingText => 'Loading...';

  @override
  String comingSoon(String title) => '$title coming soon';

  @override
  String greetingMessage(String greeting, String displayName) => '$greeting, $displayName \u{1F44B}';

  @override
  String get noActiveShipments => 'No active shipments';

  @override
  String get routeHistoryComingSoon => 'Route history coming soon';

  @override
  String get walletAddressUpdated => 'Wallet address updated';

  @override
  String get polygonWalletAddress => 'Polygon Wallet Address';

  @override
  String get saveWalletAddress => 'Save Wallet Address';

  @override
  String error(String errorMsg) => 'Error: $errorMsg';

  @override
  String get lightTheme => 'Light';

  @override
  String get darkTheme => 'Dark';

  @override
  String get retry => 'Retry';

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
  String get welcomeBack => 'Welcome Back';

  @override
  String get signInSubtitle => 'Sign in to continue';

  @override
  String get phoneNumber => 'Phone Number';

  @override
  String get sendOtp => 'Send OTP';

  @override
  String get sendingOtp => 'Sending OTP...';

  @override
  String get verifyingOtp => 'Verifying...';

  @override
  String get verifyOtp => 'Verify OTP';

  @override
  String get loginWithBiometrics => 'Login with Biometrics';

  @override
  String get biometricsNotSupported => 'Biometrics not supported on this device';

  @override
  String get biometricAuthSuccessful => 'Biometric authentication successful';

  @override
  String get pleaseEnterPhone => 'Please enter your phone number';

  @override
  String get phoneDigitsOnly => 'Phone number must contain digits only';

  @override
  String phoneMustBeExactDigits(int digitCount) => 'Phone number must be exactly $digitCount digits';

  @override
  String get phoneMustBeDigits => 'Phone number must contain only digits';

  @override
  String get verificationFailed => 'Verification failed. Please try again.';

  @override
  String get phoneVerificationFailed => 'Phone verification failed. Please try again.';

  @override
  String get autoVerificationFailed => 'Auto-verification failed. Please enter the OTP manually.';

  @override
  String get failedToSendOtp => 'Failed to send OTP. Please try again.';

  @override
  String get enterOtp => 'Enter OTP';

  @override
  String sentTo(String phoneNumber) => 'Sent to $phoneNumber';

  @override
  String get invalidOtp => 'Invalid OTP. Please check and try again.';

  @override
  String get verificationSessionExpired => 'Verification session has expired. Please request a new OTP.';

  @override
  String get invalidVerificationCode => 'Invalid verification code.';

  @override
  String get otpExpired => 'OTP has expired. Please request a new one.';

  @override
  String get home => 'Home';

  @override
  String get findTrucks => 'Find Trucks';

  @override
  String get orders => 'Orders';

  @override
  String get profile => 'Profile';

  @override
  String get activeShipments => 'Active Shipments';

  @override
  String get seeAll => 'See All';

  @override
  String get bookATruck => 'Book a Truck';

  @override
  String get active => 'Active';

  @override
  String get moreStats => 'More Stats';

  @override
  String get savings => 'Savings';

  @override
  String get yourUsualRoutes => 'Your Usual Routes';

  @override
  String get lastTruckLocation => 'Last Truck Location';

  @override
  String get couldNotLoadData => 'Could not load data';

  @override
  String get mlPoweredMatching => 'ML-Powered Matching';

  @override
  String get route => 'Route';

  @override
  String get pickupLocation => 'Pickup Location';

  @override
  String get dropLocation => 'Drop Location';

  @override
  String get date => 'Date';

  @override
  String get time => 'Time';

  @override
  String get goodsDetails => 'Goods Details';

  @override
  String get goodsType => 'Goods Type';

  @override
  String get weightTonnes => 'Weight (Tonnes)';

  @override
  String get lengthFt => 'Length (ft)';

  @override
  String get widthFt => 'Width (ft)';

  @override
  String get heightFt => 'Height (ft)';

  @override
  String get stackable => 'Stackable';

  @override
  String get fragile => 'Fragile';

  @override
  String get specialRequirements => 'Special Requirements';

  @override
  String get estimatedPriceRange => 'Estimated Price Range';

  @override
  String get stableThisWeek => 'Stable this week';

  @override
  String get estimatingPrice => 'Estimating price...';

  @override
  String get estimateUnavailable => 'Estimate unavailable';

  @override
  String get enterRouteDetails => 'Enter route details to get started';

  @override
  String get basedOnCurrentDemand => 'Based on current demand';

  @override
  String get filterTrucks => 'Filter Trucks';

  @override
  String get truckType => 'Truck Type';

  @override
  String get capacityTonnes => 'Capacity (Tonnes)';

  @override
  String get materialType => 'Material Type';

  @override
  String get today => 'Today';

  @override
  String get tomorrow => 'Tomorrow';

  @override
  String get selectPickupOnMap => 'Select Pickup on Map';

  @override
  String get selectDropOnMap => 'Select Drop on Map';

  @override
  String get temperatureControl => 'Temperature Control';

  @override
  String get waterproofCover => 'Waterproof Cover';

  @override
  String get loadingHelp => 'Loading Help';

  @override
  String get loadingHelpNeeded => 'Loading help needed';

  @override
  String get other => 'Other';

  @override
  String get describeYourGoods => 'Describe your goods...';

  @override
  String get activeTab => 'Active';

  @override
  String get historyTab => 'History';

  @override
  String get searchOrdersHint => 'Search orders...';

  @override
  String get noActiveOrders => 'No active orders';

  @override
  String get noHistoryOrders => 'No order history';

  @override
  String get offlineMode => 'Offline Mode';

  @override
  String lastUpdated(String timeAgo) => 'Last updated $timeAgo';

  @override
  String get driverAssigned => 'Driver Assigned';

  @override
  String get inTransit => 'In Transit';

  @override
  String get paymentReleased => 'Payment Released';

  @override
  String get delivered => 'Delivered';

  @override
  String get cancelled => 'Cancelled';

  @override
  String get pending => 'Pending';

  @override
  String get account => 'Account';

  @override
  String get preferences => 'Preferences';

  @override
  String get paymentMethods => 'Payment Methods';

  @override
  String get myDocuments => 'My Documents';

  @override
  String get savedAddresses => 'Saved Addresses';

  @override
  String get walletAddressLabel => 'Wallet Address';

  @override
  String get notSet => 'Not Set';

  @override
  String get language => 'Language';

  @override
  String get helpSupport => 'Help & Support';

  @override
  String get aboutTruxify => 'About Truxify';

  @override
  String get logout => 'Logout';

  @override
  String offlineModeLabel(String timeAgo) => 'Offline Mode (last updated $timeAgo)';

  @override
  String get ordersLabel => 'Orders';

  @override
  String get savedLabel => 'Saved';

  @override
  String get co2Label => 'CO\u2082 Saved';

  @override
  String get editProfile => 'Edit Profile';

  @override
  String get fullName => 'Full Name';

  @override
  String get companyName => 'Company Name';

  @override
  String get phone => 'Phone';

  @override
  String get enterFullName => 'Enter your full name';

  @override
  String get enterCompanyName => 'Enter your company name';

  @override
  String get enterPhoneNumber => 'Enter your phone number';

  @override
  String get nameIsRequired => 'Name is required';

  @override
  String get companyNameIsRequired => 'Company name is required';

  @override
  String get phoneNumberIsRequired => 'Phone number is required';

  @override
  String get saving => 'Saving...';

  @override
  String get saveChanges => 'Save Changes';

  @override
  String get profileUpdatedSuccessfully => 'Profile updated successfully';

  @override
  String get failedToLoadProfile => 'Failed to load profile';

  @override
  String get failedToUpdateProfile => 'Failed to update profile';

  @override
  String get orderNotFound => 'Order not found';

  @override
  String get notification => 'Notification';

  @override
  String get unableToOpen => 'Unable to open notification';
  String get downloadInvoice => 'Download Invoice';

  @override
  String get generatingInvoice => 'Generating Invoice...';

  @override
  String get invoiceReady => 'Invoice ready';

  @override
  String get shareInvoice => 'Share Invoice';

  @override
  String get printInvoice => 'Print Invoice';

  @override
  String get downloadFailed => 'Download failed';

  @override
  String get noRoutesFound => 'No routes found';

  @override
  String get bookAgain => 'Book Again';

  @override
  String get viewAllOrders => 'View All Orders';

  @override
  String get recentRoutes => 'Recent Routes';
}
