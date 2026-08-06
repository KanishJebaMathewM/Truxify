import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

/// Regression gate for GitHub issue #6557.
///
/// The `_confirmOtp` method previously contained a duplicated
/// `final body = await _apiClient.post(` statement (the same call written
/// twice), which broke compilation of `delivery_otp_screen.dart`.
///
/// This source-gate test pins the fix: exactly one confirm-otp POST is
/// issued, so the regression cannot silently return without breaking CI.
void main() {
  final sourcePath = File('lib/screens/delivery_otp_screen.dart');

  test('delivery_otp_screen.dart exists for the regression gate', () {
    expect(sourcePath.existsSync(), isTrue,
        reason: 'Source file under test must exist');
  });

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
}
