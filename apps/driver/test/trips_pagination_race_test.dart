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

/// Controls the data returned by the mocked trips API so we can exercise the
/// pagination race described in #11450.
class _TripsApiState {
  _TripsApiState();

  /// When true the page-2 (load-more) response is delayed so an in-flight
  /// load-more can be superseded by a concurrent refresh.
  bool delayLoadMore = false;

  /// Number of trips returned on page 1.
  List<Map<String, dynamic>> page1Trips() => [
        _trip('trip-1', '#TX-2026-001'),
        _trip('trip-2', '#TX-2026-002'),
        _trip('trip-3', '#TX-2026-003'),
        _trip('trip-4', '#TX-2026-004'),
        _trip('trip-5', '#TX-2026-005'),
      ];

  /// Page 2 re-includes `trip-1` (a stale/duplicate page-1 entry) plus a new
  /// trip. Without the dedup + request-token guards this would append
  /// duplicates and stale pages.
  List<Map<String, dynamic>> page2Trips() => [
        _trip('trip-1', '#TX-2026-001'),
        _trip('trip-6', '#TX-2026-006'),
      ];

  static Map<String, dynamic> _trip(String id, String displayId) => {
        'id': id,
        'trip_display_id': displayId,
        'route_label': 'Route $displayId',
        'trip_date': '2026-08-01',
        'total_earnings': 520000,
        'net_earnings': 450000,
        'base_freight': 520000,
        'fuel_deducted': 50000,
        'toll_deducted': 15000,
        'platform_fee': 5000,
        'blockchain_hash': '0xabc123hash',
        'verified_on_chain': true,
        'stars': 5,
      };
}

class MockHttpOverrides extends HttpOverrides {
  final _TripsApiState apiState;
  MockHttpOverrides(this.apiState);

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return _MockHttpClient(apiState);
  }
}

class _MockHttpClient extends Fake implements HttpClient {
  _MockHttpClient(this.apiState);
  final _TripsApiState apiState;

  @override
  Future<HttpClientRequest> getUrl(Uri url) async {
    return _MockHttpClientRequest(url, apiState);
  }

  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async {
    return _MockHttpClientRequest(url, apiState);
  }

  @override
  set badCertificateCallback(
      bool Function(X509Certificate cert, String host, int port)? callback) {}
}

class _MockHttpClientRequest extends Fake implements HttpClientRequest {
  _MockHttpClientRequest(this.url, this.apiState);
  final Uri url;
  final _TripsApiState apiState;

  @override
  final HttpHeaders headers = _MockHttpHeaders();

  @override
  Future<HttpClientResponse> close() async {
    return _MockHttpClientResponse(url, apiState);
  }
}

class _MockHttpHeaders extends Fake implements HttpHeaders {
  @override
  void add(String name, Object value,
      {bool preserveHeaderCase = false}) {}
  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) {}
}

class _MockHttpClientResponse extends Fake implements HttpClientResponse {
  _MockHttpClientResponse(this.url, this.apiState);
  final Uri url;
  final _TripsApiState apiState;

  @override
  int get statusCode => 200;

  @override
  HttpHeaders get headers => _MockHttpHeaders();

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int> event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) {
    final path = url.path;
    final query = url.query;
    late final String responseBody;
    var delayed = false;

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
      final page = int.tryParse(
            Uri.splitQueryString(query)['page'] ?? '1',
          ) ??
          1;
      if (page <= 1) {
        responseBody = jsonEncode({
          'page': 1,
          'limit': 20,
          'totalPages': 2,
          'trips': apiState.page1Trips(),
        });
      } else {
        // Simulate the in-flight load-more lagging behind a refresh.
        delayed = apiState.delayLoadMore;
        responseBody = jsonEncode({
          'page': 2,
          'limit': 20,
          'totalPages': 2,
          'trips': apiState.page2Trips(),
        });
      }
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
    } else if (path.contains('/api/trips/')) {
      // stops / items / route-points
      responseBody = '[]';
    } else {
      responseBody = '{}';
    }

    final data = utf8.encode(responseBody);
    final stream = Stream<List<int>>.fromFuture(
      Future.delayed(
        delayed ? const Duration(milliseconds: 400) : Duration.zero,
        () => data,
      ),
    );
    return stream.listen(
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
  late _TripsApiState apiState;

  setUpAll(() async {
    HttpOverrides.global = MockHttpOverrides(apiState = _TripsApiState());
    await setupTestEnvironment();
  });

  tearDownAll(() {
    HttpOverrides.global = null;
  });

  /// Reproduces the race: a pull-to-refresh interleaves with an in-flight
  /// load-more. The load-more response re-includes a page-1 trip id and a new
  /// trip. With the fix, the stale load-more result is ignored (request token)
  /// and any overlap is deduplicated, so no duplicate or stale pages appear.
  testWidgets(
    'refresh concurrent with in-flight load-more produces no duplicate or stale pages',
    (WidgetTester tester) async {
      apiState.delayLoadMore = true;
      // Use a short viewport so the list is scrollable and load-more can fire.
      tester.binding.window.physicalSizeTestValue = const Size(400, 500);
      tester.binding.window.devicePixelRatioTestValue = 1.0;

      await tester.pumpWidget(_buildTestApp());
      await tester.pumpAndSettle();

      // Page 1 is loaded (5 trips).
      expect(find.text('#TX-2026-001'), findsOneWidget);
      expect(find.text('#TX-2026-005'), findsOneWidget);

      // Scroll to the bottom to trigger an in-flight load-more (page 2, delayed).
      await tester.fling(
        find.byType(CustomScrollView),
        const Offset(0, -400),
        1000,
      );
      await tester.pump();

      // While the load-more is still in-flight, trigger a pull-to-refresh.
      await tester.fling(
        find.byType(CustomScrollView),
        const Offset(0, 300),
        1000,
      );
      await tester.pump();

      // Let the delayed load-more complete after the refresh has applied.
      await tester.pumpAndSettle();

      // The refreshed page 1 is intact...
      expect(find.text('#TX-2026-001'), findsOneWidget);
      expect(find.text('#TX-2026-005'), findsOneWidget);

      // ...and the stale/duplicate page-2 entries were never appended.
      expect(find.text('#TX-2026-001'), findsOneWidget);
      expect(find.text('#TX-2026-006'), findsNothing);

      tester.binding.window.clearPhysicalSizeTestValue();
      tester.binding.window.clearDevicePixelRatioTestValue();
    },
  );

  /// Reproduces the overlap case directly: when a load-more page re-includes
  /// a trip id already present, it must be deduplicated rather than appended.
  testWidgets(
    'load-more does not append duplicate trips already in the list',
    (WidgetTester tester) async {
      apiState.delayLoadMore = false;
      tester.binding.window.physicalSizeTestValue = const Size(400, 500);
      tester.binding.window.devicePixelRatioTestValue = 1.0;

      await tester.pumpWidget(_buildTestApp());
      await tester.pumpAndSettle();

      await tester.fling(
        find.byType(CustomScrollView),
        const Offset(0, -400),
        1000,
      );
      await tester.pumpAndSettle();

      // trip-1 was on page 1 and re-appears on page 2 — it must not be doubled.
      expect(find.text('#TX-2026-001'), findsOneWidget);
      // trip-6 from page 2 is appended exactly once.
      expect(find.text('#TX-2026-006'), findsOneWidget);

      tester.binding.window.clearPhysicalSizeTestValue();
      tester.binding.window.clearDevicePixelRatioTestValue();
    },
  );
}
