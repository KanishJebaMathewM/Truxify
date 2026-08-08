import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:truxify_driver/models/app_models.dart';
import 'package:truxify_driver/screens/active_trip_screen.dart';
import 'package:truxify_driver/services/marketplace_repository.dart';
import 'package:truxify_driver/theme/app_theme.dart';

class MockMarketplaceRepository extends Mock implements MarketplaceRepository {}

Widget _buildTestApp(Trip trip, {List<TripStop>? stops, MarketplaceRepository? repo}) {
  return MaterialApp(
    theme: TruxifyTheme.light(),
    home: ActiveTripScreen(
      trip: trip,
      stops: stops,
      marketplaceRepository: repo,
    ),
  );
}

void main() {
  late MockMarketplaceRepository mockRepo;

  const testTrip = Trip(
    route: 'Surat → Bhiwandi → Chakan',
    date: '07 Aug 2026',
    items: ['Textiles 2.5t', 'Auto Parts 1.8t'],
    itemCount: '2 stops · 340 km',
    distance: '340 km',
    earnings: '₹28,500',
    status: TripStatusType.active,
    tripId: 'TX-1001',
    hash: '0xabc123',
    duration: '6 hrs',
  );

  setUp(() {
    mockRepo = MockMarketplaceRepository();
    when(() => mockRepo.confirmTripStop(
      tripId: any(named: 'tripId'),
      stopId: any(named: 'stopId'),
      otp: any(named: 'otp'),
    )).thenAnswer((_) async => {
      'success': true,
      'allCompleted': false,
      'paymentReleased': false,
    });
  });

  testWidgets('ActiveTripScreen renders trip summary and stop cards', (tester) async {
    await tester.pumpWidget(_buildTestApp(testTrip, repo: mockRepo));
    await tester.pumpAndSettle();

    expect(find.text('Active Trip'), findsOneWidget);
    expect(find.text('Surat → Bhiwandi → Chakan'), findsOneWidget);
    expect(find.text('₹28,500'), findsOneWidget);
    expect(find.text('Google Maps'), findsOneWidget);
    expect(find.text('Bhiwandi Hub'), findsOneWidget);
    expect(find.text('Chakan Hub'), findsOneWidget);
  });

  testWidgets('enters OTP and confirms stop delivery', (tester) async {
    await tester.pumpWidget(_buildTestApp(testTrip, repo: mockRepo));
    await tester.pumpAndSettle();

    // Enter 6-digit OTP in first stop's OTP field
    final otpField = find.byType(TextField).first;
    await tester.enterText(otpField, '123456');
    await tester.pumpAndSettle();

    // Tap Confirm button
    final confirmBtn = find.text('Confirm').first;
    await tester.tap(confirmBtn);
    await tester.pumpAndSettle();

    // Verify confirmTripStop was called
    verify(() => mockRepo.confirmTripStop(
      tripId: 'TX-1001',
      stopId: 'Bhiwandi Hub',
      otp: '123456',
    )).called(1);

    // Verify stop-1 updated to Delivered
    expect(find.text('Delivered'), findsOneWidget);
  });

  testWidgets('displays Trip Complete banner when all stops are delivered', (tester) async {
    final completedStops = [
      const TripStop(
        customer: 'Bhiwandi Hub',
        route: 'Surat → Bhiwandi',
        goods: 'Textiles',
        statusLabel: 'Delivered',
        earningsLabel: '₹14,000',
        tripPath: 'Surat → Bhiwandi',
        dropLocation: 'Bhiwandi',
        tonnes: '2.5',
        isCurrent: false,
        isCompleted: true,
      ),
      const TripStop(
        customer: 'Chakan Hub',
        route: 'Bhiwandi → Chakan',
        goods: 'Auto Components',
        statusLabel: 'Delivered',
        earningsLabel: '₹14,500',
        tripPath: 'Bhiwandi → Chakan',
        dropLocation: 'Chakan',
        tonnes: '1.8',
        isCurrent: false,
        isCompleted: true,
      ),
    ];

    await tester.pumpWidget(_buildTestApp(testTrip, stops: completedStops, repo: mockRepo));
    await tester.pumpAndSettle();

    expect(find.text('Trip Complete ✓'), findsOneWidget);
    expect(find.textContaining('Smart contract payment of ₹28,500 released'), findsOneWidget);
  });
}
