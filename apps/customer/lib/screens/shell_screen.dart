import 'package:flutter/material.dart';

import '../controllers/app_controller.dart';
import '../theme/app_theme.dart';
import 'find_trucks_screen.dart';
import 'home_screen.dart';
import 'orders_screen.dart';
import 'profile_screen.dart';

class TruxifyShellScreen extends StatefulWidget {
  const TruxifyShellScreen({super.key});

  @override
  State<TruxifyShellScreen> createState() => _TruxifyShellScreenState();
}

class _TruxifyShellScreenState extends State<TruxifyShellScreen> {
  final GlobalKey<NavigatorState> _homeNavigatorKey = GlobalKey<NavigatorState>();
  final GlobalKey<NavigatorState> _findNavigatorKey = GlobalKey<NavigatorState>();
  final GlobalKey<NavigatorState> _ordersNavigatorKey = GlobalKey<NavigatorState>();
  final GlobalKey<NavigatorState> _profileNavigatorKey = GlobalKey<NavigatorState>();

  @override
  Widget build(BuildContext context) {
    final controller = TruxifyScope.of(context);

    return Scaffold(
      body: IndexedStack(
        index: controller.currentTab,
        children: [
          _buildNavigator(_homeNavigatorKey, const HomeScreen()),
          _buildNavigator(_findNavigatorKey, const FindTrucksScreen()),
          _buildNavigator(_ordersNavigatorKey, const OrdersScreen()),
          _buildNavigator(_profileNavigatorKey, const ProfileScreen()),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).navigationBarTheme.backgroundColor,
          border: Border(top: BorderSide(color: (Theme.of(context).brightness == Brightness.dark ? TruxifyColors.darkBorder : TruxifyColors.border), width: 1)),
        ),
        child: NavigationBar(
          selectedIndex: controller.currentTab,
          onDestinationSelected: controller.setTab,
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          destinations: const [
            NavigationDestination(icon: Icon(Icons.home_rounded), label: 'Home'),
            NavigationDestination(icon: Icon(Icons.search_rounded), label: 'Find Trucks'),
            NavigationDestination(icon: Icon(Icons.inventory_2_rounded), label: 'Orders'),
            NavigationDestination(icon: Icon(Icons.person_rounded), label: 'Profile'),
          ],
        ),
      ),
    );
  }

  Widget _buildNavigator(GlobalKey<NavigatorState> key, Widget root) {
    return Navigator(
      key: key,
      onGenerateRoute: (settings) {
        return MaterialPageRoute<void>(builder: (_) => root, settings: settings);
      },
    );
  }
}
