import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Import your actual LoginScreen widget
// import 'package:customer/screens/auth/login_screen.dart';

// ─── Stub LoginScreen for testing (remove once actual screen is imported) ────
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneController = TextEditingController();
  String? _errorText;

  void _sendOtp() {
    final phone = _phoneController.text.trim();
    if (phone.length != 10 || !RegExp(r'^\d+$').hasMatch(phone)) {
      setState(() => _errorText = 'Enter a valid 10-digit mobile number');
    } else {
      setState(() => _errorText = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            TextField(
              key: const Key('phone_field'),
              controller: _phoneController,
              keyboardType: TextInputType.phone,
              decoration: InputDecoration(
                labelText: 'Mobile Number',
                errorText: _errorText,
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              key: const Key('send_otp_btn'),
              onPressed: _sendOtp,
              child: const Text('Send OTP'),
            ),
          ],
        ),
      ),
    );
  }
}
// ─── End Stub ────────────────────────────────────────────────────────────────

void main() {
  group('LoginScreen Widget Tests', () {

    testWidgets(
      'renders phone number input and Send OTP button',
      (WidgetTester tester) async {
        await tester.pumpWidget(
          const MaterialApp(home: LoginScreen()),
        );

        expect(find.byKey(const Key('phone_field')), findsOneWidget);
        expect(find.byKey(const Key('send_otp_btn')), findsOneWidget);
        expect(find.text('Send OTP'), findsOneWidget);
        expect(find.text('Mobile Number'), findsOneWidget);
      },
    );

    testWidgets(
      'shows validation error for empty phone number',
      (WidgetTester tester) async {
        await tester.pumpWidget(
          const MaterialApp(home: LoginScreen()),
        );

        // Tap without entering any number
        await tester.tap(find.byKey(const Key('send_otp_btn')));
        await tester.pump();

        expect(
          find.text('Enter a valid 10-digit mobile number'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'shows validation error for phone number less than 10 digits',
      (WidgetTester tester) async {
        await tester.pumpWidget(
          const MaterialApp(home: LoginScreen()),
        );

        await tester.enterText(
          find.byKey(const Key('phone_field')),
          '98765',
        );
        await tester.tap(find.byKey(const Key('send_otp_btn')));
        await tester.pump();

        expect(
          find.text('Enter a valid 10-digit mobile number'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'shows no error for valid 10-digit phone number',
      (WidgetTester tester) async {
        await tester.pumpWidget(
          const MaterialApp(home: LoginScreen()),
        );

        await tester.enterText(
          find.byKey(const Key('phone_field')),
          '9876543210',
        );
        await tester.tap(find.byKey(const Key('send_otp_btn')));
        await tester.pump();

        expect(
          find.text('Enter a valid 10-digit mobile number'),
          findsNothing,
        );
      },
    );

    testWidgets(
      'shows validation error for non-numeric input',
      (WidgetTester tester) async {
        await tester.pumpWidget(
          const MaterialApp(home: LoginScreen()),
        );

        await tester.enterText(
          find.byKey(const Key('phone_field')),
          'abcdefghij',
        );
        await tester.tap(find.byKey(const Key('send_otp_btn')));
        await tester.pump();

        expect(
          find.text('Enter a valid 10-digit mobile number'),
          findsOneWidget,
        );
      },
    );
  });
}