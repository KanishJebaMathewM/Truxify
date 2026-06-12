import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/models/app_models.dart';
import 'package:truxify_driver/screens/trip_detail_screen.dart';
import 'package:truxify_driver/theme/app_theme.dart';

Widget _buildTestApp(Trip trip) {
  return MaterialApp(
    theme: TruxifyTheme.light(),
    home: TripDetailScreen(trip: trip),
  );
}

void main() {
  const testTrip = Trip(
    route: 'Surat → Jaipur',
    date: '12 Jun 2026',
    items: ['Textile 3t'],
    itemCount: '1 item · 900 km',
    distance: '900 km',
    earnings: '₹12,000',
    status: TripStatusType.active,
    tripId: 'TRIP-123',
    hash: '0x1234567890abcdef',
    duration: '15 hrs',
    endTime: '12 Jun, 08:00 PM',
    paymentBreakdown: PaymentBreakdown(
      baseFreight: '₹15,000',
      fuelDeducted: '₹2,000',
      tollDeducted: '₹800',
      platformFee: '₹200',
      netEarnings: '₹12,000',
    ),
    tripItems: [
      TripItem(
        customerName: 'Acme Corp',
        goods: 'Textile 3t',
        destination: 'Jaipur',
        earnings: '₹12,000',
        delivered: false,
      ),
    ],
  );

  testWidgets('TripDetailScreen renders and does not loop infinitely', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_buildTestApp(testTrip));
    
    // We expect the widget to render the detail screen.
    expect(find.text('Trip Details'), findsOneWidget);
    
    // If there is an infinite loop of rebuilds, pumpAndSettle will timeout.
    // We set a short duration or try pumpAndSettle with a short timeout.
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
  });
}
