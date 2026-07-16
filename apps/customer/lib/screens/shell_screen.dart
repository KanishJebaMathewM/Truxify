import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_shared/truxify_shared.dart';

import '../controllers/app_controller.dart';
import '../l10n/app_localizations.dart';
import '../models/app_models.dart';
import '../services/fcm_service.dart';
import '../services/order_service.dart';
import '../theme/app_theme.dart';
import 'find_trucks_screen.dart';
import 'home_screen.dart';
import 'order_detail_screen.dart';
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
  final OrderService _orderService = OrderService();

  @override
  void initState() {
    super.initState();
    FcmService.initializeAndRegister();
    ForegroundNotificationHandler.setup(
      context: context,
      onTap: _handleNotificationNavigation,
    );
    ForegroundNotificationHandler.handleInitialMessage(
      onTap: _handleNotificationNavigation,
    );
    ForegroundNotificationHandler.handleBackgroundTap(
      onTap: _handleNotificationNavigation,
    );
  }

  @override
  void dispose() {
    ForegroundNotificationHandler.dispose();
    super.dispose();
  }

  Future<void> _handleNotificationNavigation(
    NotificationTarget target,
    Map<String, dynamic> data,
  ) async {
    if (!mounted) return;

    switch (target) {
      case NotificationTarget.orderDetail:
        await _navigateToOrderDetail(data);
        break;
      case NotificationTarget.notifications:
        _navigateToNotifications();
        break;
      default:
        _navigateToNotifications();
        break;
    }
  }

  Future<void> _navigateToOrderDetail(Map<String, dynamic> data) async {
    final orderId = NotificationRouter.extractOrderId(data);
    if (orderId == null || !mounted) {
      _navigateToNotifications();
      return;
    }

    final orderMap = await _orderService.fetchOrderById(orderId);
    if (!mounted) return;

    if (orderMap == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context)!.orderNotFound)),
      );
      return;
    }

    final rawAmount = orderMap['total_amount'] ?? 0;
    final amountInRupees = (rawAmount is num)
        ? (rawAmount / 100).toStringAsFixed(0)
        : rawAmount.toString();

    final driverName = orderMap['profiles'] is Map<String, dynamic>
        ? (orderMap['profiles']['full_name']?.toString().trim() ?? 'Driver Assigned')
        : orderMap['driver_name']?.toString().trim() ?? 'Driver Assigned';

    final truckNumber = orderMap['truck_number']?.toString().trim().isNotEmpty == true
        ? orderMap['truck_number'].toString().trim()
        : '—';

    String formatPaise(dynamic value) {
      if (value is! num) return '';
      return 'Rs ${(value / 100).toStringAsFixed(0)}';
    }

    final order = HistoryOrderData(
      orderId: orderMap['order_display_id']?.toString() ?? orderId,
      route: '${orderMap['pickup_address'] ?? ''} → ${orderMap['drop_address'] ?? ''}',
      date: orderMap['pickup_date']?.toString() ?? '',
      amount: '₹$amountInRupees',
      status: orderMap['status']?.toString() ?? '',
      driver: driverName,
      truckNumber: truckNumber,
      timeline: [],
      blockchainTxHash: orderMap['blockchain_tx_hash']?.toString(),
      baseFare: formatPaise(orderMap['base_fare']),
      distanceCharge: formatPaise(orderMap['distance_charge']),
      tollCharge: formatPaise(orderMap['toll_charge']),
      platformFee: formatPaise(orderMap['platform_fee']),
    );

    // Switch to Orders tab and push detail screen.
    final controller = TruxifyScope.of(context);
    controller.setTab(2);

    _ordersNavigatorKey.currentState?.push(
      MaterialPageRoute<void>(
        builder: (_) => OrderDetailScreen(order: order),
      ),
    );
  }

  void _navigateToNotifications() {
    final controller = TruxifyScope.of(context);
    controller.setTab(3);
  }

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
          destinations: [
            NavigationDestination(icon: Icon(Icons.home_rounded), label: AppLocalizations.of(context)!.home),
            NavigationDestination(icon: Icon(Icons.search_rounded), label: AppLocalizations.of(context)!.findTrucks),
            NavigationDestination(icon: Icon(Icons.inventory_2_rounded), label: AppLocalizations.of(context)!.orders),
            NavigationDestination(icon: Icon(Icons.person_rounded), label: AppLocalizations.of(context)!.profile),
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
