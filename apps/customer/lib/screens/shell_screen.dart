import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:truxify_shared/truxify_shared.dart';

import '../controllers/app_controller.dart';
import '../l10n/app_localizations.dart';
import '../models/app_models.dart';
import '../services/fcm_service.dart';
import '../theme/app_theme.dart';
import '../widgets/app_page_route.dart';
import 'find_trucks_screen.dart';
import 'home_screen.dart';
import 'live_tracking_screen.dart';
import 'notifications_screen.dart';
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

  @override
  void initState() {
    super.initState();
    _initNotifications();
  }

  void _initNotifications() {
    NotificationRouter.setAppType(NotificationAppType.customer);

    // Register the navigation callback for notification taps.
    if (!NotificationRouter.isCallbackRegistered) {
      NotificationRouter.registerNavigateCallback(_onNavigate);
    }

    // Register foreground notification callback.
    FcmService.setForegroundCallback(_onForegroundMessage);

    // Register tap callback for background/terminated notifications.
    FcmService.setTapCallback((payload) {
      if (!mounted) return;
      final route = NotificationRouter.resolve(payload);
      _onNavigate(context, route);
    });

    // Initialize push notifications.
    FcmService.initializeAndRegister();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Handle cold-start notification after the widget tree is built.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      FcmService.handleInitialMessage().then((handled) {
        if (handled) debugPrint('[Shell] Cold-start notification handled.');
      });
    });
  }

  void _onForegroundMessage(RemoteMessage message, NotificationPayload payload) {
    if (!mounted) return;
    final title = payload.title ?? message.notification?.title ?? '';
    final body = payload.body ?? message.notification?.body ?? '';

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (title.isNotEmpty)
              Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
            if (body.isNotEmpty) Text(body),
          ],
        ),
        duration: const Duration(seconds: 4),
        action: SnackBarAction(
          label: 'View',
          onPressed: () {
            final route = NotificationRouter.resolve(payload);
            _onNavigate(context, route);
          },
        ),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  void _onNavigate(BuildContext context, NotificationRoute route) {
    switch (route) {
      case NavigateToOrderDetail(:final orderId):
        _openInOrdersTab(() {
          _ordersNavigatorKey.currentState?.push(
            AppPageRoute(
              builder: (_) => OrderDetailScreen(
                order: HistoryOrderData(
                  orderId: orderId,
                  route: '',
                  date: '',
                  amount: '',
                  status: '',
                  driver: '',
                  truckNumber: '',
                  timeline: const [],
                ),
              ),
            ),
          );
        });

      case NavigateToLiveTracking(:final orderId):
        _openInOrdersTab(() {
          _ordersNavigatorKey.currentState?.push(
            AppPageRoute(
              builder: (_) => LiveTrackingScreen(orderId: orderId),
            ),
          );
        });

      case NavigateToWallet():
        _switchTab(3);

      case NavigateToSupportTicket():
        // Navigate to notifications screen — support ticket detail is
        // handled inside the shared notifications screen.
        _openInHomeTab(() {
          _homeNavigatorKey.currentState?.push(
            AppPageRoute(builder: (_) => const NotificationsScreen()),
          );
        });

      case NavigateToNotificationsList():
        _openInHomeTab(() {
          _homeNavigatorKey.currentState?.push(
            AppPageRoute(builder: (_) => const NotificationsScreen()),
          );
        });

      case NavigateToEarnings():
      case NavigateToLoadDetail():
        // Customer app doesn't have earnings/LoadDetail; fall through to
        // notifications.
        _openInHomeTab(() {
          _homeNavigatorKey.currentState?.push(
            AppPageRoute(builder: (_) => const NotificationsScreen()),
          );
        });
    }
  }

  void _openInHomeTab(VoidCallback navigate) {
    final controller = TruxifyScope.of(context);
    controller.setTab(0);
    navigate();
  }

  void _openInOrdersTab(VoidCallback navigate) {
    final controller = TruxifyScope.of(context);
    controller.setTab(2);
    navigate();
  }

  void _switchTab(int index) {
    final controller = TruxifyScope.of(context);
    controller.setTab(index);
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
