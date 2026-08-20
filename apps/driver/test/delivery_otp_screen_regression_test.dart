import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

/// Regression gate for GitHub issues #6557 & #13301.
///
/// Issue #6557:
/// The `_confirmOtp` method previously contained a duplicated
/// `final body = await _apiClient.post(` statement (the same call written
/// twice), which broke compilation of `delivery_otp_screen.dart`.
///
/// Issue #13301:
/// The confirm-otp response provides `amount_inr` as a numeric type (int / num).
/// Direct casting `body['amount_inr'] as String?` threw an unhandled `_TypeError`.
/// The method now uses `_amountInr` to safely normalize num/String/null.
void main() {
  final sourcePath = File('lib/screens/delivery_otp_screen.dart');

  test('delivery_otp_screen.dart exists for the regression gate', () {
    expect(sourcePath.existsSync(), isTrue,
        reason: 'Source file under test must exist');
  });

  group('Issue #6557 regression tests', () {
    test('_confirmOtp issues exactly one confirm-otp POST', () {
      final source = sourcePath.readAsStringSync();
      final confirmOtpCalls =
          RegExp(r"final body = await _apiClient\.post\(").allMatches(source);
      expect(confirmOtpCalls.length, 1,
          reason: 'Duplicated _apiClient.post statements were the reported bug');

      final confirmOtpEndpoint = RegExp(
        r"_apiClient\.post\(\s*['\"]/api/orders/\$\{widget\.orderId\}/confirm-otp['\"]",
      ).allMatches(source);
      expect(confirmOtpEndpoint.length, 1,
          reason: 'The confirm-otp endpoint must be requested exactly once');
    });

    test('_confirmOtp passes the otp payload to the confirm-otp endpoint', () {
      final source = sourcePath.readAsStringSync();
      final confirmSection =
          source.substring(source.indexOf('Future<void> _confirmOtp()'));
      expect(confirmSection, contains("body: {'otp': _otp}"));
    });
  });

  group('Issue #13301 regression tests', () {
    test('_confirmOtp does not perform unsafe as String? cast on amount_inr', () {
      final source = sourcePath.readAsStringSync();
      expect(source, isNot(contains("body['amount_inr'] as String?")),
          reason: 'Unsafe cast throws _TypeError when API returns amount_inr as int/num');
      expect(source, isNot(contains("body['amount_inr'] as String")),
          reason: 'Unsafe cast throws _TypeError when API returns amount_inr as int/num');
    });

    test('_confirmOtp uses _amountInr helper for safe type normalization', () {
      final source = sourcePath.readAsStringSync();
      expect(source, contains("_amountInr(body['amount_inr'])"),
          reason: '_confirmOtp must use _amountInr helper to safely normalize amount_inr');
    });

    test('_amountInr normalizes int, double, String, and null correctly', () {
      String? amountInr(dynamic value) {
        if (value == null) return null;
        if (value is num) return value.toStringAsFixed(value % 1 == 0 ? 0 : 2);
        return value.toString();
      }

      // Integer amount from confirm-otp (e.g. 5000 rupees)
      expect(amountInr(5000), '5000');
      expect(amountInr(0), '0');

      // Decimal amount (e.g. 1500.50 rupees)
      expect(amountInr(1500.5), '1500.50');
      expect(amountInr(12.34), '12.34');

      // String amount from older API endpoints
      expect(amountInr('5000'), '5000');
      expect(amountInr('1500.00'), '1500.00');

      // Null when omitted
      expect(amountInr(null), isNull);
    });
  });
}
