import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// ─── Mock Service Interfaces ─────────────────────────────────────────────────
// These mirror the actual service classes in the app.
// Add @GenerateMocks annotation and run build_runner to generate .mocks.dart

abstract class AuthServiceInterface {
  Future<bool> signInWithPhone(String phone);
  Future<bool> verifyOtp(String phone, String otp);
  Future<void> signOut();
  bool get isAuthenticated;
  String? get currentUserId;
}

abstract class ApiServiceInterface {
  Future<List<Map<String, dynamic>>> getAvailableLoads();
  Future<Map<String, dynamic>> getBookingById(String bookingId);
  Future<bool> acceptLoad(String loadId);
}

abstract class LocationServiceInterface {
  Stream<Map<String, double>> get locationStream;
  Future<Map<String, double>> getCurrentLocation();
}

// ─── Widget Test Helpers ─────────────────────────────────────────────────────

/// Wraps a widget in the full app scaffold needed for testing:
/// MaterialApp, MediaQuery, and mock service providers.
///
/// Usage:
///   await tester.pumpWidget(
///     buildTestableWidget(child: LoginScreen()),
///   );
Widget buildTestableWidget({
  required Widget child,
  ThemeData? theme,
  String? initialRoute,
  Size screenSize = const Size(390, 844), // iPhone 14 Pro dimensions
}) {
  return MaterialApp(
    theme: theme ?? ThemeData.light(),
    home: MediaQuery(
      data: MediaQueryData(size: screenSize),
      child: Scaffold(body: child),
    ),
  );
}

/// Pumps a widget and waits for all animations to settle.
/// Use instead of tester.pump() for widgets with animations.
Future<void> pumpAndSettle(WidgetTester tester, Widget widget) async {
  await tester.pumpWidget(buildTestableWidget(child: widget));
  await tester.pumpAndSettle();
}

/// Finds a widget by its key string.
Finder findByKey(String key) => find.byKey(Key(key));

/// Enters text into a field and triggers form validation.
Future<void> enterTextAndValidate(
  WidgetTester tester,
  Finder field,
  String text,
) async {
  await tester.tap(field);
  await tester.enterText(field, text);
  await tester.pump();
}