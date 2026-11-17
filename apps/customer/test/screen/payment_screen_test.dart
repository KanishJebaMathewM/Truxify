import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify/screens/payment_screen.dart';

void main() {
  group('PaymentScreen and PaymentMethodsScreen back navigation', () {
    testWidgets('hardware back button pops the payment screen', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => ElevatedButton(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const PaymentScreen(),
                    ),
                  );
                },
                child: const Text('Open Payment'),
              ),
            ),
          ),
        ),
      );

      // Open screen
      await tester.tap(find.text('Open Payment'));
      await tester.pumpAndSettle();
      expect(find.byType(PaymentScreen), findsOneWidget);
      expect(find.byType(PopScope), findsAtLeastNWidgets(1));

      // Simulate Android hardware back button
      final dynamic widgetsBinding = tester.binding;
      final bool handled = await widgetsBinding.handlePopRoute();
      await tester.pumpAndSettle();

      // Should return to previous screen
      expect(handled, isTrue);
      expect(find.byType(PaymentScreen), findsNothing);
      expect(find.text('Open Payment'), findsOneWidget);
    });

    testWidgets('hardware back button pops PaymentMethodsScreen', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => ElevatedButton(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const PaymentMethodsScreen(),
                    ),
                  );
                },
                child: const Text('Open Payment Methods'),
              ),
            ),
          ),
        ),
      );

      // Open screen
      await tester.tap(find.text('Open Payment Methods'));
      await tester.pumpAndSettle();
      expect(find.byType(PaymentMethodsScreen), findsOneWidget);
      expect(find.byType(PopScope), findsOneWidget);

      // Simulate Android hardware back button
      final dynamic widgetsBinding = tester.binding;
      final bool handled = await widgetsBinding.handlePopRoute();
      await tester.pumpAndSettle();

      // Should return to previous screen
      expect(handled, isTrue);
      expect(find.byType(PaymentMethodsScreen), findsNothing);
      expect(find.text('Open Payment Methods'), findsOneWidget);
    });
  });
}
