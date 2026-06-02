import 'package:flutter/material.dart';

import '../core/app_routes.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_page_route.dart';
import 'home_screen.dart';
import 'documents_screen.dart';
import 'destination_picker_screen.dart';
import 'earnings_screen.dart';
import 'load_detail_screen.dart';
import 'load_point_detail_screen.dart';
import 'profile_screen.dart';
import 'trip_detail_screen.dart';
import 'trips_screen.dart';
import 'my_truck_screen.dart';

class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key});

  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  final GlobalKey<NavigatorState> _homeNavigatorKey =
      GlobalKey<NavigatorState>();
  final GlobalKey<NavigatorState> _tripsNavigatorKey =
      GlobalKey<NavigatorState>();
  final GlobalKey<NavigatorState> _earningsNavigatorKey =
      GlobalKey<NavigatorState>();
  final GlobalKey<NavigatorState> _profileNavigatorKey =
      GlobalKey<NavigatorState>();
  final ValueNotifier<int> _currentIndex = ValueNotifier<int>(0);
  late final List<Widget> _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = [
      _buildTabNavigator(_homeNavigatorKey, const HomeScreen()),
      _buildTabNavigator(_tripsNavigatorKey, const TripsScreen()),
      _buildTabNavigator(_earningsNavigatorKey, const EarningsScreen()),
      _buildTabNavigator(
        _profileNavigatorKey,
        ProfileScreen(
          onOpenDocuments: () =>
              _profileNavigatorKey.currentState?.pushNamed(AppRoutes.documents),
          onSelectTab: _openTab,
        ),
      ),
    ];
  }

  @override
  void dispose() {
    _currentIndex.dispose();
    super.dispose();
  }

  void _openTab(int index) {
    _currentIndex.value = index;
  }

  Route<dynamic> _errorRoute() {
    return truxifyPageRoute(
      (context) => const Scaffold(
        body: Center(
          child: Text('Error: Invalid route arguments'),
        ),
      ),
    );
  }

  Route<dynamic>? _routeFactory(RouteSettings settings) {
    switch (settings.name) {
      case AppRoutes.myTruck:
        return truxifyPageRoute((context) => const MyTruckScreen());
      case AppRoutes.tripDetail:
        final args = settings.arguments;
        if (args is! Trip) {
          return _errorRoute();
        }
        return truxifyPageRoute((context) => TripDetailScreen(trip: args));

      case AppRoutes.documents:
        return truxifyPageRoute((context) => const DocumentsScreen());
      case AppRoutes.loadDetail:
        final args = settings.arguments;
        if (args is! LoadOffer) {
          return _errorRoute();
        }
        return truxifyPageRoute((context) => LoadDetailScreen(load: args));
      case AppRoutes.loadPointDetail:
        final args = settings.arguments;
        if (args is! RouteMapPoint) {
          return _errorRoute();
        }
        return truxifyPageRoute(
            (context) => LoadPointDetailScreen(point: args));
      case AppRoutes.destinationPicker:
        final args = settings.arguments as DestinationPickerArgs?;
        return truxifyPageRoute(
          (context) => DestinationPickerScreen(
            title: args?.title ?? 'Select Destination',
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
        final route = _routeFactory(settings);
        return route ?? truxifyPageRoute((context) => root);
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
            )),
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
                    label: 'Trips',
                    selected: currentIndex == 1,
                    onTap: () => _openTab(1),
                  ),
                  _NavItem(
                    icon: Icons.account_balance_wallet_outlined,
                    label: 'Earnings',
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
                  color:
                      selected ? TruxifyColors.accentLight : Colors.transparent,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  icon,
                  size: 20,
                  color: selected
                      ? TruxifyColors.accent
                      : TruxifyColors.adaptiveSecondaryText(context),
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
                      ? TruxifyColors.accent
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
