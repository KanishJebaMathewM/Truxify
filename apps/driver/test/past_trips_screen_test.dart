import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_driver/controllers/app_controller.dart';
import 'package:truxify_driver/screens/past_trips_screen.dart';
import 'package:truxify_driver/theme/app_theme.dart';
import 'package:truxify_shared/truxify_shared.dart';

import 'setup/test_setup.dart';

class MockHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return MockHttpClient();
  }
}

class MockHttpClient extends Fake implements HttpClient {
  @override
  Future<HttpClientRequest> getUrl(Uri url) async {
    return MockHttpClientRequest(url);
  }

  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async {
    return MockHttpClientRequest(url);
  }

  @override
  set badCertificateCallback(bool Function(X509Certificate cert, String host, int port)? callback) {}
}

class MockHttpClientRequest extends Fake implements HttpClientRequest {
  final Uri url;
  MockHttpClientRequest(this.url);

  @override
  final HttpHeaders headers = MockHttpHeaders();

  @override
  Future<HttpClientResponse> close() async {
    return MockHttpClientResponse(url);
  }
}

class MockHttpHeaders extends Fake implements HttpHeaders {
  @override
  void add(String name, Object value, {bool preserveHeaderCase = false}) {}
  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) {}
}

class MockHttpClientResponse extends Fake implements HttpClientResponse {
  final Uri url;
  MockHttpClientResponse(this.url);

  @override
  int get statusCode => 200;

  @override
  HttpHeaders get headers => MockHttpHeaders();

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int> event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) {
    String responseBody = '{}';
    final path = url.path;

    if (path.contains('/api/driver/') && path.contains('/reputation')) {
      responseBody = '''
      {
        "driverId": "mock-driver-id",
        "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
        "onChainScore": 9600,
        "supabaseRating": 4.9
      }
      ''';
    } else if (path.contains('/api/driver/trips')) {
      responseBody = '''
      {
        "page": 1,
        "limit": 20,
        "totalPages": 1,
        "trips": [
          {
            "id": "trip-1",
            "trip_display_id": "#TX-2026-001",
            "route_label": "Surat → Vadodara",
            "trip_date": "2026-08-01",
            "total_earnings": 520000,
            "net_earnings": 450000,
            "base_freight": 520000,
            "fuel_deducted": 50000,
            "toll_deducted": 15000,
            "platform_fee": 5000,
            "blockchain_hash": "0xabc123hash",
            "verified_on_chain": true,
            "stars": 5
          }
        ]
      }
      ''';
    } else if (path.contains('/rest/v1/profiles')) {
      responseBody = '''
      {
        "polygon_wallet_address": "0x1234567890abcdef1234567890abcdef12345678",
        "driver_details": {
          "rating": 4.9,
          "total_trips": 15
        }
      }
      ''';
    }

    final data = utf8.encode(responseBody);
    return Stream<List<int>>.fromIterable([data]).listen(
      onData,
      onError: onError,
      onDone: onDone,
      cancelOnError: cancelOnError,
    );
  }
}

Widget _buildTestApp() {
  final controller = TruxifyController();
  return TruxifyScope(
    controller: controller,
    child: MaterialApp(
      theme: TruxifyTheme.light(),
      home: const PastTripsScreen(),
    ),
  );
}

void main() {
  setUpAll(() async {
    HttpOverrides.global = MockHttpOverrides();
    await setupTestEnvironment();
  });

  tearDownAll(() {
    HttpOverrides.global = null;
  });

  testWidgets('PastTripsScreen renders reputation metrics and trip list', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestApp());
    await tester.pumpAndSettle();

    // Verify Title
    expect(find.text('Past Trips & Reputation'), findsOneWidget);

    // Verify On-Chain Reputation Score & Tier
    expect(find.text('96.0'), findsOneWidget);
    expect(find.text('PLATINUM TIER'), findsOneWidget);
    expect(find.text('RATING'), findsOneWidget);
    expect(find.text('4.9'), findsOneWidget);

    // Verify Share Button
    expect(find.text('Share On-Chain Reputation'), findsOneWidget);

    // Verify Trip Card
    expect(find.text('#TX-2026-001'), findsOneWidget);
    expect(find.text('Surat → Vadodara'), findsOneWidget);
    expect(find.text('₹5200'), findsOneWidget);
    expect(find.text('Net: ₹4500'), findsOneWidget);

    // Verify rating stars are rendered (5 stars)
    expect(find.byIcon(Icons.star_rounded), findsNWidgets(6)); // 1 in header, 5 in trip card
  });

  testWidgets('Tapping trip card expands detailed earnings breakdown', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestApp());
    await tester.pumpAndSettle();

    // Verification: Earnings breakdown is NOT visible initially
    expect(find.text('EARNINGS BREAKDOWN'), findsNothing);

    // Tap trip card to expand
    await tester.tap(find.text('Surat → Vadodara'));
    await tester.pumpAndSettle();

    // Verification: Earnings breakdown details are visible
    expect(find.text('EARNINGS BREAKDOWN'), findsOneWidget);
    expect(find.text('Gross Freight'), findsOneWidget);
    expect(find.text('Fuel Deduction (Est.)'), findsOneWidget);
    expect(find.text('- ₹500'), findsOneWidget);
    expect(find.text('Toll Estimate'), findsOneWidget);
    expect(find.text('- ₹150'), findsOneWidget);
    expect(find.text('Platform Fee'), findsOneWidget);
    expect(find.text('- ₹50'), findsOneWidget);
    expect(find.text('Net Paid'), findsOneWidget);
  });
}
