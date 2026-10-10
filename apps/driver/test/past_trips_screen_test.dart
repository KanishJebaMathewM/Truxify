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
  void close({bool force = false}) {}

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

  // The IO machinery drives these setters/methods — absorb them rather than
  // throw UnimplementedError (which silently failed the screen's fetch).
  @override
  bool followRedirects = true;
  @override
  int contentLength = -1;
  @override
  Future<void> addStream(Stream<List<int>> stream) async {}
  @override
  Future<void> flush() async {}
  @override
  Future<HttpClientResponse> get done =>
      Future.value(MockHttpClientResponse(url));

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.isSetter) return null;
    return super.noSuchMethod(invocation);
  }

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
  @override
  void forEach(void Function(String name, List<String> values) action) {
    // package:http decodes the body with latin-1 unless the content-type
    // declares a charset — the JSON fixtures contain '→' (mojibake without
    // this).
    action('content-type', ['application/json; charset=utf-8']);
  }
}

class MockHttpClientResponse extends Fake implements HttpClientResponse {
  final Uri url;
  MockHttpClientResponse(this.url);

  @override
  int get statusCode => 200;

  @override
  int get contentLength => -1;
  @override
  bool get isRedirect => false;
  @override
  bool get persistentConnection => false;
  @override
  String get reasonPhrase => 'OK';
  @override
  List<RedirectInfo> get redirects => const [];

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


class _FakeUser implements User {
  @override
  String get id => 'mock-driver-id';
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _MockGoTrueClient implements GoTrueClient {
  @override
  User? get currentUser => _FakeUser();
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The screen's reputation fetch does:
///   from('profiles').select('...').eq('id', driverId).maybeSingle()
/// via package:supabase's own HTTP (NOT dart:io — HttpOverrides can't
/// intercept it), so the client is injected (screen seam) and the Postgrest
/// chain is faked here. `implements` (not extends) means noSuchMethod catches
/// every member, including `then`.
/// select() -> PostgrestFilterBuilder<PostgrestList>; eq() stays; the
/// awaited maybeSingle() -> PostgrestTransformBuilder<Map?>.
class _FakeProfilesTransformBuilder
    implements PostgrestTransformBuilder<Map<String, dynamic>?> {
  final Map<String, dynamic> _row = {
    'polygon_wallet_address':
        '0x1234567890abcdef1234567890abcdef12345678',
    'driver_details': {'rating': 4.9, 'total_trips': 7},
  };

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #then) {
      final onValue = invocation.positionalArguments[0] as Function;
      final onError = invocation.namedArguments[#onError] as Function?;
      return Future.value(_row).then((v) => onValue(v), onError: onError);
    }
    return this;
  }
}

class _FakeProfilesFilterBuilder
    implements PostgrestFilterBuilder<List<Map<String, dynamic>>> {
  final _FakeProfilesTransformBuilder _transform =
      _FakeProfilesTransformBuilder();

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #maybeSingle) return _transform;
    return this;
  }
}

class _FakeSupabaseClient implements SupabaseClient {
  final GoTrueClient _auth = _MockGoTrueClient();

  @override
  GoTrueClient get auth => _auth;

  @override
  SupabaseQueryBuilder from(String relation) {
    return _FakeQueryBuilder(_FakeProfilesFilterBuilder());
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      super.noSuchMethod(invocation);
}

class _FakeQueryBuilder implements SupabaseQueryBuilder {
  final _FakeProfilesFilterBuilder _builder;
  _FakeQueryBuilder(this._builder);

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #select) return _builder;
    return this;
  }
}

Widget _buildTestApp() {
  final controller = TruxifyController();
  return TruxifyScope(
    controller: controller,
    child: MaterialApp(
      theme: TruxifyTheme.light(),
      home: PastTripsScreen(client: _FakeSupabaseClient()),
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
