import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_driver/screens/demand_heatmap_screen.dart';
import 'package:truxify_shared/truxify_shared.dart';

void main() {
  testWidgets('loads demand heatmap through the shared ApiClient', (tester) async {
    Uri? requestedUri;

    final client = MockClient((request) async {
      requestedUri = request.url;
      return http.Response(
        jsonEncode({
          'type': 'FeatureCollection',
          'features': [
            {
              'type': 'Feature',
              'geometry': {
                'type': 'Point',
                'coordinates': [77.2090, 28.6139],
              },
              'properties': {
                'intensity': 0.8,
                'status': 'available',
                'address': 'Delhi',
              },
            },
          ],
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });

    final apiClient = ApiClient(
      httpClient: client,
      baseUrl: 'https://api.example.test',
      supabaseClient: SupabaseClient(
        'https://example.supabase.co',
        'test-anon-key',
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: DemandHeatmapScreen(apiClient: apiClient),
      ),
    );
    await tester.pumpAndSettle();

    expect(requestedUri?.path, '/api/demand-heatmap');
    expect(requestedUri?.queryParameters, isEmpty);
    expect(find.text('Delhi'), findsOneWidget);
    expect(find.text('Demand Heatmap — Next 48 hrs'), findsOneWidget);
  });

  test('parses GeoJSON heatmap features', () {
    final zones = HeatZone.fromResponse({
      'type': 'FeatureCollection',
      'features': [
        {
          'type': 'Feature',
          'geometry': {
            'type': 'Point',
            'coordinates': ['77.2090', '28.6139'],
          },
          'properties': {
            'intensity': '0.65',
            'status': 'claimed',
            'address': 'Delhi Logistics Hub',
          },
        },
      ],
    });

    expect(zones, hasLength(1));
    expect(zones.single.lat, 28.6139);
    expect(zones.single.lng, 77.2090);
    expect(zones.single.intensity, 0.65);
    expect(zones.single.label, 'Delhi Logistics Hub');
  });
}
