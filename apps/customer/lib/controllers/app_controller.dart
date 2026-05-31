import 'package:flutter/material.dart';

import '../models/app_models.dart';

class TruxifyController extends ChangeNotifier {
  int currentTab = 0;
  int ordersTabIndex = 0;
  RouteDraft? pendingRouteDraft;
  bool _isDarkMode = false;

  bool get isDarkMode => _isDarkMode;

  void toggleDarkMode() {
    _isDarkMode = !_isDarkMode;
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

class TruxifyScope extends InheritedNotifier<TruxifyController> {
  const TruxifyScope({
    super.key,
    required TruxifyController controller,
    required super.child,
  }) : super(notifier: controller);

  static TruxifyController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<TruxifyScope>();
    assert(scope != null, 'TruxifyScope not found in widget tree.');
    return scope!.notifier!;
  }
}
