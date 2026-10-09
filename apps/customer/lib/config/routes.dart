import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

// Mock Screens for Navigation Hierarchy
class HomeScreen extends StatelessWidget {
  const HomeScreen({Key? key}) : super(key: key);
  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: Text('Home Dashboard')));
}

class LoginScreen extends StatelessWidget {
  const LoginScreen({Key? key}) : super(key: key);
  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: Text('Customer Login')));
}

class BookFreightScreen extends StatelessWidget {
  final String? truckType;
  const BookFreightScreen({Key? key, this.truckType}) : super(key: key);
  @override
  Widget build(BuildContext context) => Scaffold(body: Center(child: Text('Book Freight Workspace (Truck: ${truckType ?? 'Standard'})')));
}

class ActiveShipmentsScreen extends StatelessWidget {
  const ActiveShipmentsScreen({Key? key}) : super(key: key);
  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: Text('Active Shipments List')));
}

class OrderDetailScreen extends StatelessWidget {
  final String orderId;
  const OrderDetailScreen({Key? key, required this.orderId}) : super(key: key);
  @override
  Widget build(BuildContext context) => Scaffold(body: Center(child: Text('Order Detail View: $orderId')));
}

class TrackingScreen extends StatelessWidget {
  final String trackingNumber;
  const TrackingScreen({Key? key, required this.trackingNumber}) : super(key: key);
  @override
  Widget build(BuildContext context) => Scaffold(body: Center(child: Text('Live Shipment Tracking: $trackingNumber')));
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({Key? key}) : super(key: key);
  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: Text('Customer Profile')));
}

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({Key? key}) : super(key: key);
  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: Text('Settings & Preferences')));
}

// Global App Router Configuration
class AppRouter {
  // Mock authentication state (in production, integrate with AuthBloc or token provider)
  static bool isAuthenticated = true;

  static final GoRouter router = GoRouter(
    initialLocation: '/',
    debugLogDiagnostics: true,
    redirect: (BuildContext context, GoRouterState state) {
      final bool isLoggingIn = state.matchedLocation == '/login';

      // Route Guard: If not authenticated and trying to access private route, redirect to /login
      if (!isAuthenticated && !isLoggingIn) {
        return '/login';
      }

      // If authenticated and trying to access login, redirect to home
      if (isAuthenticated && isLoggingIn) {
        return '/';
      }

      return null; // No redirect needed
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
          final truckParam = state.uri.queryParameters['truck'];
          return BookFreightScreen(truckType: truckParam);
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
              final orderId = state.pathParameters['id'] ?? 'UNKNOWN';
              return OrderDetailScreen(orderId: orderId);
            },
          ),
        ],
      ),
      GoRoute(
        path: '/track/:trackingNumber',
        name: 'track',
        builder: (context, state) {
          final trackingNumber = state.pathParameters['trackingNumber'] ?? 'TRX-000';
          return TrackingScreen(trackingNumber: trackingNumber);
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
