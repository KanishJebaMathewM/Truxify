import 'package:flutter/material.dart';

import '../models/app_models.dart';

class FreightFairController extends ChangeNotifier {
  int currentTab = 0;
  int ordersTabIndex = 0;
  RouteDraft? pendingRouteDraft;
  bool _isDarkMode = false;
  String _selectedLanguageCode = 'en';

  bool get isDarkMode => _isDarkMode;
  String get selectedLanguageCode => _selectedLanguageCode;

  String get selectedLanguageName {
    switch (_selectedLanguageCode) {
      case 'hi':
        return 'Hindi';
      case 'gu':
        return 'Gujarati';
      case 'mr':
        return 'Marathi';
      case 'ta':
        return 'Tamil';
      case 'te':
        return 'Telugu';
      case 'en':
      default:
        return 'English';
    }
  }

  void toggleDarkMode() {
    _isDarkMode = !_isDarkMode;
    notifyListeners();
  }

  void changeLanguage(String code) {
    if (_selectedLanguageCode == code) return;
    _selectedLanguageCode = code;
    notifyListeners();
  }

  void setTab(int index) {
    if (currentTab == index) return;
    currentTab = index;
    notifyListeners();
  }

  void openFindTrucks({RouteDraft? draft}) {
    pendingRouteDraft = draft;
    currentTab = 1;
    notifyListeners();
  }

  RouteDraft? consumePendingRouteDraft() {
    final draft = pendingRouteDraft;
    pendingRouteDraft = null;
    return draft;
  }

  void openOrders({int tabIndex = 0}) {
    ordersTabIndex = tabIndex;
    currentTab = 2;
    notifyListeners();
  }

  void setOrdersTab(int index) {
    if (ordersTabIndex == index) return;
    ordersTabIndex = index;
    notifyListeners();
  }
}

class FreightFairScope extends InheritedNotifier<FreightFairController> {
  const FreightFairScope({
    super.key,
    required FreightFairController controller,
    required super.child,
  }) : super(notifier: controller);

  static FreightFairController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<FreightFairScope>();
    assert(scope != null, 'FreightFairScope not found in widget tree.');
    return scope!.notifier!;
  }
}
