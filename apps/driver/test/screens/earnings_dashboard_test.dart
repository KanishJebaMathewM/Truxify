import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../lib/screens/earnings_dashboard.dart';
import '../../lib/services/api_client.dart';

class _FakeApiClient extends ApiClient {
  _FakeApiClient(this.responses) : super(baseUrl: 'https://example.com');

  final List<Object> responses;
  final List<String> requests = [];

  @override
  Future<dynamic> get(
    String path, {
    Map<String, String>? headers,
  }) async {
    requests.add(path);
    final response = responses.removeAt(0);
    if (response is Exception) throw response;
    return response;
  }
}

Map<String, dynamic> _summaryResponse({
  int tripCount = 1,
  double totalGross = 12000,
}) {
  return {
    'success': true,
    'data': {
      'period': 'monthly',
      'driverId': 'driver-1',
      'totalGross': totalGross,
      'totalDeductions': 2000,
      'netEarnings': totalGross - 2000,
      'tripCount': tripCount,
      'brokerSavingsPercent': 35,
      'trips': [
        {
          'id': 'trip-1',
          'date': '2026-09-16T12:00:00.000Z',
          'distance': 120,
          'gross': totalGross,
          'deductions': 2000,
          'net': totalGross - 2000,
        },
      ],
    },
  };
}

void main() {
  testWidgets('loads monthly earnings from the backend', (tester) async {
    final apiClient = _FakeApiClient([_summaryResponse()]);

    await tester.pumpWidget(
      MaterialApp(
        home: EarningsDashboard(apiClient: apiClient),
      ),
    );
    await tester.pumpAndSettle();

    expect(apiClient.requests, ['/api/earnings/summary?period=monthly']);
    expect(find.text('₹10000 net'), findsOneWidget);
    expect(find.text('₹12000'), findsOneWidget);
    expect(find.text('1'), findsOneWidget);
  });

  testWidgets('fetches fresh data when the period changes', (tester) async {
    final apiClient = _FakeApiClient([
      _summaryResponse(totalGross: 12000),
      _summaryResponse(totalGross: 8000),
    ]);

    await tester.pumpWidget(
      MaterialApp(
        home: EarningsDashboard(apiClient: apiClient),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('This Week'));
    await tester.pumpAndSettle();

    expect(apiClient.requests, [
      '/api/earnings/summary?period=monthly',
      '/api/earnings/summary?period=weekly',
    ]);
    expect(find.text('₹6000 net'), findsOneWidget);
  });

  testWidgets('shows an error and retries successfully', (tester) async {
    final apiClient = _FakeApiClient([
      const ApiException(503, 'Service unavailable'),
      _summaryResponse(),
    ]);

    await tester.pumpWidget(
      MaterialApp(
        home: EarningsDashboard(apiClient: apiClient),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text("Couldn't load earnings"), findsOneWidget);
    expect(find.text('Service unavailable'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(find.text('₹10000 net'), findsOneWidget);
    expect(apiClient.requests.length, 2);
  });
}
