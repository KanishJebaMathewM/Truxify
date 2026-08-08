import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_driver/controllers/app_controller.dart';
import 'package:truxify_driver/screens/driver_profile_screen.dart';
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
    return MockHttpClientRequest('GET', url);
  }

  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async {
    return MockHttpClientRequest(method, url);
  }

  @override
  set badCertificateCallback(bool Function(X509Certificate cert, String host, int port)? callback) {}
}

class MockHttpClientRequest extends Fake implements HttpClientRequest {
  final String method;
  final Uri url;
  MockHttpClientRequest(this.method, this.url);

  @override
  final HttpHeaders headers = MockHttpHeaders();

  @override
  Future<HttpClientResponse> close() async {
    return MockHttpClientResponse(method, url);
  }
}

class MockHttpHeaders extends Fake implements HttpHeaders {
  @override
  void add(String name, Object value, {bool preserveHeaderCase = false}) {}
  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) {}
}

class MockHttpClientResponse extends Fake implements HttpClientResponse {
  final String method;
  final Uri url;
  MockHttpClientResponse(this.method, this.url);

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

    if (method == 'GET' && path.contains('/api/driver/profile')) {
      responseBody = '''
      {
        "profile": {
          "id": "driver-id-123",
          "full_name": "John Doe",
          "phone": "+919876543210",
          "email": "john.doe@truxify.com"
        },
        "driverDetails": {
          "rating": 4.8,
          "total_trips": 42,
          "is_online": true,
          "kyc_status": "Verified"
        },
        "truck": {
          "id": "truck-123",
          "truck_type": "Tata Ultra",
          "capacity_weight_tonnes": 12.5,
          "capacity_volume_m3": 38.0,
          "registration_number": "MH12AB1234"
        },
        "documents": {
          "rc_book": "Verified (Digilocker)",
          "driving_licence": "Uploaded",
          "insurance": "Missing"
        }
      }
      ''';
    } else if (method == 'PATCH' && path.contains('/api/driver/availability')) {
      responseBody = '{"success": true, "isOnline": false}';
    } else if (method == 'PUT' && path.contains('/api/driver/truck')) {
      responseBody = '''
      {
        "success": true,
        "truck": {
          "id": "truck-123",
          "truck_type": "Tata Ultra Pro",
          "capacity_weight_tonnes": 15.0,
          "capacity_volume_m3": 45.0,
          "registration_number": "MH12AB1234"
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
      home: const DriverProfileScreen(),
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

  testWidgets('DriverProfileScreen renders all metrics and details correctly', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestApp());
    await tester.pumpAndSettle();

    // Verify Driver Info
    expect(find.text('John Doe'), findsOneWidget);
    expect(find.text('+919876543210'), findsOneWidget);
    expect(find.text('john.doe@truxify.com'), findsOneWidget);

    // Verify Availability details
    expect(find.text('Online (Ready for Jobs)'), findsOneWidget);

    // Verify On-Chain Reputation
    expect(find.text('4.8'), findsOneWidget);
    expect(find.text('42'), findsOneWidget);
    expect(find.text('Verified'), findsOneWidget);

    // Verify Truck details
    expect(find.text('Tata Ultra'), findsOneWidget);
    expect(find.text('12.5 Tonnes'), findsOneWidget);
    expect(find.text('38.0 m³'), findsOneWidget);
    expect(find.text('MH12AB1234'), findsOneWidget);

    // Verify Documents badges
    expect(find.text('Verified (Digilocker)'), findsOneWidget);
    expect(find.text('Uploaded'), findsOneWidget);
    expect(find.text('Missing'), findsOneWidget);
  });

  testWidgets('Tapping availability toggle switches online status', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestApp());
    await tester.pumpAndSettle();

    expect(find.text('Online (Ready for Jobs)'), findsOneWidget);

    // Toggle duty status
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();

    expect(find.text('Offline (Unavailable)'), findsOneWidget);
  });

  testWidgets('Tapping edit truck icon opens sheet and saves details', (WidgetTester tester) async {
    await tester.pumpWidget(_buildTestApp());
    await tester.pumpAndSettle();

    expect(find.text('Tata Ultra'), findsOneWidget);

    // Tap edit icon
    await tester.tap(find.byIcon(Icons.edit));
    await tester.pumpAndSettle();

    // Bottom sheet is visible
    expect(find.text('Edit Truck Details'), findsOneWidget);

    // Form fields are prepopulated
    expect(find.widgetWithText(TextFormField, 'Tata Ultra'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, '12.5'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, '38.0'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, 'MH12AB1234'), findsOneWidget);

    // Modify Type and Capacity
    await tester.enterText(find.widgetWithText(TextFormField, 'Tata Ultra'), 'Tata Ultra Pro');
    await tester.enterText(find.widgetWithText(TextFormField, '12.5'), '15.0');
    await tester.enterText(find.widgetWithText(TextFormField, '38.0'), '45.0');
    await tester.pumpAndSettle();

    // Save changes
    await tester.tap(find.widgetWithText(PrimaryButton, 'Save Truck Details'));
    await tester.pumpAndSettle();

    // Bottom sheet closed and snackbar displayed
    expect(find.text('Edit Truck Details'), findsNothing);
    expect(find.text('Truck details updated successfully!'), findsOneWidget);
  });
}
