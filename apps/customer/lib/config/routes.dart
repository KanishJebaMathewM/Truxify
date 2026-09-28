import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../screens/splash_screen.dart';
import '../screens/public_tracking_screen.dart';

/// Application route paths.
class AppRoutes {
  static const String home = '/';
  static const String login = '/login';
  static const String book = '/book';
  static const String trucks = '/trucks';
  static const String orders = '/orders';
  static const String orderDetails = '/orders/:id';
  static const String tracking = '/track/:trackingNumber';
  static const String profile = '/profile';
  static const String settings = '/settings';
}

/// Application router.
class AppRouter {
  AppRouter({
    required this.isAuthenticated,
  });

  /// Returns whether the customer is currently authenticated.
  final bool Function() isAuthenticated;

  late final GoRouter router = GoRouter(
    initialLocation: AppRoutes.home,

    redirect: (BuildContext context, GoRouterState state) {
      final bool loggedIn = isAuthenticated();

      final String location = state.matchedLocation;

      final bool isLoginRoute = location == AppRoutes.login;

      // Public routes.
      final bool isPublicRoute =
          location == AppRoutes.home ||
          location == AppRoutes.login ||
          location.startsWith('/track/');

      // User is not logged in and is trying to access
      // a protected route.
      if (!loggedIn && !isPublicRoute) {
        return AppRoutes.login;
      }

      // User is already logged in and tries to open login.
      if (loggedIn && isLoginRoute) {
        return AppRoutes.home;
      }

      return null;
    },

    routes: <RouteBase>[
      GoRoute(
        path: AppRoutes.home,
        name: 'home',
        builder: (context, state) {
          return const SplashScreen();
        },
      ),

      GoRoute(
        path: AppRoutes.login,
        name: 'login',
        builder: (context, state) {
          return const Scaffold(
            body: Center(
              child: Text('Login'),
            ),
          );
        },
      ),

      GoRoute(
        path: AppRoutes.book,
        name: 'book',
        builder: (context, state) {
          final String? truck = state.uri.queryParameters['truck'];

          return Scaffold(
            appBar: AppBar(
              title: const Text('Book'),
            ),
            body: Center(
              child: Text(
                truck == null
                    ? 'Booking'
                    : 'Booking truck: $truck',
              ),
            ),
          );
        },
      ),

      GoRoute(
        path: AppRoutes.trucks,
        name: 'trucks',
        builder: (context, state) {
          return const Scaffold(
            body: Center(
              child: Text('Trucks'),
            ),
          );
        },
      ),

      GoRoute(
        path: AppRoutes.orders,
        name: 'orders',
        builder: (context, state) {
          return const Scaffold(
            body: Center(
              child: Text('Orders'),
            ),
          );
        },
      ),

      GoRoute(
        path: AppRoutes.orderDetails,
        name: 'orderDetails',
        builder: (context, state) {
          final String orderId =
              state.pathParameters['id']!;

          return Scaffold(
            appBar: AppBar(
              title: Text('Order $orderId'),
            ),
            body: Center(
              child: Text(
                'Order ID: $orderId',
              ),
            ),
          );
        },
      ),

      GoRoute(
        path: AppRoutes.tracking,
        name: 'tracking',
        builder: (context, state) {
          final String trackingNumber =
              state.pathParameters['trackingNumber']!;

          return PublicTrackingScreen(
            token: trackingNumber,
          );
        },
      ),

      GoRoute(
        path: AppRoutes.profile,
        name: 'profile',
        builder: (context, state) {
          return const Scaffold(
            body: Center(
              child: Text('Profile'),
            ),
          );
        },
      ),

      GoRoute(
        path: AppRoutes.settings,
        name: 'settings',
        builder: (context, state) {
          return const Scaffold(
            body: Center(
              child: Text('Settings'),
            ),
          );
        },
      ),
    ],
  );
}
