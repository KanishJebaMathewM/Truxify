
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

// Mock Screens for Navigation Hierarchy

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('Home Dashboard')),
    );
  }
}

class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('Customer Login')),
    );
  }
}

class BookFreightScreen extends StatelessWidget {
  final String? truckType;

  const BookFreightScreen({
    super.key,
    this.truckType,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Text(
          'Book Freight Workspace (Truck: ${truckType ?? 'Standard'})',
        ),
      ),
    );
  }
}

class ActiveShipmentsScreen extends StatelessWidget {
  const ActiveShipmentsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('Active Shipments List')),
    );
  }
}

class OrderDetailScreen extends StatelessWidget {
  final String orderId;

  const OrderDetailScreen({
    super.key,
    required this.orderId,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Text('Order Detail View: $orderId'),
      ),
    );
  }
}

class TrackingScreen extends StatelessWidget {
  final String trackingNumber;

  const TrackingScreen({
    super.key,
    required this.trackingNumber,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Text('Live Shipment Tracking: $trackingNumber'),
      ),
    );
  }
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('Customer Profile')),
    );
  }
}

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('Settings & Preferences')),
    );
  }
}

// Global App Router Configuration

class AppRouter {
  // Mock authentication state.
  // Replace with a real authentication provider in production.
  static bool isAuthenticated = true;

  static final GoRouter router = GoRouter(
    initialLocation: '/',
    debugLogDiagnostics: true,

    redirect: (BuildContext context, GoRouterState state) {
      final bool isLoggingIn = state.matchedLocation == '/login';

      // Redirect unauthenticated users to login.
      if (!isAuthenticated && !isLoggingIn) {
        return '/login';
      }

      // Redirect authenticated users away from login.
      if (isAuthenticated && isLoggingIn) {
        return '/';
      }

      return null;
    },

    routes: [
      GoRoute(
        path: '/',
        name: 'home',
        builder: (context, state) => const HomeScreen(),
      ),

      GoRoute(
        path: '/login',
        name: 'login',
        builder: (context, state) => const LoginScreen(),
      ),

      GoRoute(
        path: '/book',
        name: 'book',
        builder: (context, state) {
          final truckType = state.uri.queryParameters['truck'];

          return BookFreightScreen(
            truckType: truckType,
          );
        },
      ),

      GoRoute(
        path: '/orders',
        name: 'orders',
        builder: (context, state) => const ActiveShipmentsScreen(),
        routes: [
          GoRoute(
            path: ':id',
            name: 'order-detail',
            builder: (context, state) {
              final orderId = state.pathParameters['id']!;

              return OrderDetailScreen(
                orderId: orderId,
              );
            },
          ),
        ],
      ),

      GoRoute(
        path: '/track/:trackingNumber',
        name: 'track',
        builder: (context, state) {
          final trackingNumber =
              state.pathParameters['trackingNumber']!;

          return TrackingScreen(
            trackingNumber: trackingNumber,
          );
        },
      ),

      GoRoute(
        path: '/profile',
        name: 'profile',
        builder: (context, state) => const ProfileScreen(),
      ),

      GoRoute(
        path: '/settings',
        name: 'settings',
        builder: (context, state) => const SettingsScreen(),
      ),
    ],
  );
}

