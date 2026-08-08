import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:truxify_shared/truxify_shared.dart';

import '../core/app_routes.dart';
import '../l10n/app_localizations.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_page_route.dart';
import '../services/fcm_service.dart';
import 'home_screen.dart';
import 'documents_screen.dart';
import 'destination_picker_screen.dart';
import 'weight_calculator_screen.dart';
import 'earnings_screen.dart';
import 'load_detail_screen.dart';
import 'load_point_detail_screen.dart';
import 'notifications_screen.dart';
import 'driver_profile_screen.dart';
import 'trip_detail_screen.dart';
import 'active_trip_screen.dart';
import 'trips_screen.dart';
import 'my_truck_screen.dart';

import '../services/marketplace_repository.dart';
import '../services/driver_earnings_service.dart';

/// Bottom-nav shell that hosts the four primary driver screens.
///
/// Tab layout (issue #5708):
///   0 – Home            (HomeScreen — map, current trip card, earnings summary)
///   1 – Active Trip     (TripsScreen — list of active / recent trips)
///   2 – Available Loads (EarningsScreen re-used as load board pending a
///                        dedicated LoadBoardScreen; swap when ready)
///   3 – Profile         (ProfileScreen)
class ShellScreen extends StatefulWidget {
  const ShellScreen({
    super.key,
    this.marketplaceRepo,
    this.earningsService,
    this.mockLocationText,
  });

  final MarketplaceRepository? marketplaceRepo;
  final DriverEarningsService? earningsService;
  final String? mockLocationText;

  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  final GlobalKey<NavigatorState> _homeNavigatorKey =
      GlobalKey<NavigatorState>();
  final GlobalKey<NavigatorState> _tripsNavigatorKey =
      GlobalKey<NavigatorState>();
  final GlobalKey<NavigatorState> _loadsNavigatorKey =
      GlobalKey<NavigatorState>();
  final GlobalKey<NavigatorState> _profileNavigatorKey =
      GlobalKey<NavigatorState>();

  StreamSubscription? _weighStationSub;
  final ValueNotifier<int> _currentIndex = ValueNotifier<int>(0);
  late final List<Widget> _tabs;

  @override
  void initState() {
    super.initState();
    WeighStationService.instance.initialize();
    _weighStationSub =
        WeighStationService.instance.eventStream.listen(_showBypassAlert);

    _tabs = [
      // Tab 0 — Home
      _buildTabNavigator(
        _homeNavigatorKey,
        HomeScreen(
          marketplaceRepo: widget.marketplaceRepo ?? MarketplaceRepository(),
          earningsService: widget.earningsService ?? DriverEarningsService(),
          mockLocationText: widget.mockLocationText,
          // Navigate to Trips tab (index 1) which hosts both loads and active trips.
          onNavigateToLoads: () => _openTab(1),
          onNavigateToActiveTrip: () => _openTab(1),
        ),
      ),
      // Tab 1 — Active Trip
      _buildTabNavigator(_tripsNavigatorKey, const TripsScreen()),
      // Tab 2 — Available Loads (swap body for LoadBoardScreen when built)
      _buildTabNavigator(_loadsNavigatorKey, const EarningsScreen()),
      // Tab 3 — Profile
      _buildTabNavigator(
        _profileNavigatorKey,
        DriverProfileScreen(
          onOpenDocuments: () =>
              _profileNavigatorKey.currentState?.pushNamed(AppRoutes.documents),
          onSelectTab: _openTab,
        ),
      ),
    ];
    _initNotifications();
  }

  void _initNotifications() {
    NotificationRouter.setAppType(NotificationAppType.driver);

    if (!NotificationRouter.isCallbackRegistered) {
      NotificationRouter.registerNavigateCallback(_onNavigate);
    }

    FcmService.setForegroundCallback(_onForegroundMessage);

    FcmService.setTapCallback((payload) {
      if (!mounted) return;
      final route = NotificationRouter.resolve(payload);
      _onNavigate(context, route);
    });

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
  void didChangeDependencies() {
    super.didChangeDependencies();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      FcmService.handleInitialMessage().then((handled) {
        if (handled) debugPrint('[Shell] Cold-start notification handled.');
      });
    });
  }

  void _onForegroundMessage(
      RemoteMessage message, NotificationPayload payload) {
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
              Text(title,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
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
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  void _onNavigate(BuildContext context, NotificationRoute route) {
    switch (route) {
      case NavigateToOrderDetail():
      case NavigateToLiveTracking():
        _openTab(1); // Active Trip

      case NavigateToLoadDetail():
        _openTab(2); // Available Loads

      case NavigateToEarnings():
      case NavigateToWallet():
        _openTab(0); // Home (earnings summary is on the home card)

      case NavigateToSupportTicket():
      case NavigateToNotificationsList():
        _openInHomeTab(() {
          Navigator.of(context)
              .push(truxifyPageRoute((_) => const NotificationsScreen()));
        });
    }
  }

  void _openInHomeTab(VoidCallback navigate) {
    _openTab(0);
    navigate();
  }

  @override
  void dispose() {
    _weighStationSub?.cancel();
    FcmService.clearForegroundCallback();
    FcmService.clearTapCallback();
    ForegroundNotificationHandler.dispose();
    _currentIndex.dispose();
    super.dispose();
  }

  void _openTab(int index) {
    _currentIndex.value = index;
  }

  Future<void> _handleNotificationNavigation(
    NotificationTarget target,
    Map<String, dynamic> data,
  ) async {
    if (!mounted) return;
    switch (target) {
      case NotificationTarget.tripDetail:
        _openTab(1); // Active Trip
        break;
      case NotificationTarget.earnings:
        _openTab(0); // Home (earnings card)
        break;
      case NotificationTarget.loadDetail:
        _openTab(2); // Available Loads
        break;
      case NotificationTarget.notifications:
      case NotificationTarget.orderDetail:
      case NotificationTarget.unknown:
        _openTab(3); // Profile (notifications accessed from here)
        break;
      case NotificationTarget.documents:
        _openTab(3);
        _profileNavigatorKey.currentState?.pushNamed(AppRoutes.documents);
        break;
    }
  }

  Route<dynamic> _errorRoute() {
    return truxifyPageRoute(
      (context) => Scaffold(
        body: Center(child: Text(AppLocalizations.of(context)!.error)),
      ),
    );
  }

  Route<dynamic>? _routeFactory(RouteSettings settings) {
    switch (settings.name) {
      case AppRoutes.myTruck:
        return truxifyPageRoute((context) => const MyTruckScreen());
      case AppRoutes.tripDetail:
        final args = settings.arguments;
        if (args is! Trip) return _errorRoute();
        return truxifyPageRoute((context) => TripDetailScreen(trip: args));
      case AppRoutes.activeTrip:
        final args = settings.arguments;
        if (args is! Trip) return _errorRoute();
        return truxifyPageRoute((context) => ActiveTripScreen(trip: args));
      case AppRoutes.documents:
        return truxifyPageRoute((context) => const DocumentsScreen());
      case AppRoutes.loadDetail:
        final args = settings.arguments;
        if (args is! LoadOffer) return _errorRoute();
        return truxifyPageRoute((context) => LoadDetailScreen(load: args));
      case AppRoutes.loadPointDetail:
        final args = settings.arguments;
        if (args is! RouteMapPoint) return _errorRoute();
        return truxifyPageRoute(
            (context) => LoadPointDetailScreen(point: args));
      case AppRoutes.weightCalculator:
        return truxifyPageRoute((context) => const WeightCalculatorScreen());
      case AppRoutes.destinationPicker:
        final args = settings.arguments as DestinationPickerArgs?;
        return truxifyPageRoute(
          (context) => DestinationPickerScreen(
            title: args?.title ??
                AppLocalizations.of(context)!.whereAreYouHeading,
            initialQuery: args?.initialQuery,
            initialPoint: args?.initialPoint,
          ),
        );
      default:
        return null;
    }
  }

  Widget _buildTabNavigator(GlobalKey<NavigatorState> key, Widget root) {
    return Navigator(
      key: key,
      onGenerateRoute: (settings) {
        if (settings.name == '/' || settings.name == AppRoutes.shell) {
          return truxifyPageRoute((context) => root);
        }
        return _routeFactory(settings) ??
            truxifyPageRoute((context) => root);
      },
    );
  }

  void _showBypassAlert(WeighStationEvent event) {
    if (!mounted) return;
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) {
        final isBypass = event.action == 'BYPASS';
        return Dialog(
          backgroundColor: isBypass
              ? const Color(0xFF1E4620)
              : const Color(0xFF5C1A1A),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          child: Padding(
            padding: const EdgeInsets.all(32.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  isBypass
                      ? Icons.check_circle_outline
                      : Icons.warning_amber_rounded,
                  size: 80,
                  color: Colors.white,
                ),
                const SizedBox(height: 24),
                Text(
                  isBypass ? 'BYPASS CLEARED' : 'PULL IN REQUIRED',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Station ID: ${event.stationId}\n${event.reason}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 16, color: Colors.white70),
                ),
                const SizedBox(height: 32),
                SizedBox(
                  width: double.infinity,
                  height: 56,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: isBypass
                          ? const Color(0xFF1E4620)
                          : const Color(0xFF5C1A1A),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16)),
                    ),
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('ACKNOWLEDGE',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: ValueListenableBuilder<int>(
        valueListenable: _currentIndex,
        builder: (context, currentIndex, _) {
          return IndexedStack(
            index: currentIndex,
            children: _tabs,
          );
        },
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            border: Border(
              top: BorderSide(
                color: Theme.of(context).brightness == Brightness.dark
                    ? TruxifyColors.darkBorder
                    : TruxifyColors.border,
              ),
            ),
          ),
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
          child: ValueListenableBuilder<int>(
            valueListenable: _currentIndex,
            builder: (context, currentIndex, _) {
              return Row(
                children: [
                  _NavItem(
                    icon: Icons.home_rounded,
                    label: 'Home',
                    selected: currentIndex == 0,
                    onTap: () => _openTab(0),
                  ),
                  _NavItem(
                    icon: Icons.route_rounded,
                    label: 'Active Trip',
                    selected: currentIndex == 1,
                    onTap: () => _openTab(1),
                  ),
                  _NavItem(
                    icon: Icons.inventory_2_outlined,
                    label: 'Loads',
                    selected: currentIndex == 2,
                    onTap: () => _openTab(2),
                  ),
                  _NavItem(
                    icon: Icons.person_rounded,
                    label: 'Profile',
                    selected: currentIndex == 3,
                    onTap: () => _openTab(3),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

// ── Bottom-nav item ────────────────────────────────────────────────────────────

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: selected
                      ? (isDark
                          ? TruxifyColors.darkAccentLight
                          : TruxifyColors.accentLight)
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  icon,
                  size: 20,
                  color: selected
                      ? (isDark
                          ? TruxifyColors.accentLight
                          : TruxifyColors.accentDark)
                      : (isDark
                          ? TruxifyColors.darkSecondaryText
                          : TruxifyColors.secondaryText),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: selected
                      ? (isDark
                          ? TruxifyColors.accent
                          : TruxifyColors.accentDark)
                      : TruxifyColors.adaptiveSecondaryText(context),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}