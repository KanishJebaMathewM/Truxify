import 'package:flutter_test/flutter_test.dart';
import 'package:truxify/utils/upi_link_validator.dart';

void main() {
  group('UpiLinkValidator', () {
    test('rejects null and empty links', () {
      expect(UpiLinkValidator.isSafe(null), isFalse);
      expect(UpiLinkValidator.isSafe(''), isFalse);
    });

    test('rejects non-upi/https schemes (tel, sms, http phishing)', () {
      expect(UpiLinkValidator.isSafe('tel:1234567890'), isFalse);
      expect(UpiLinkValidator.isSafe('sms:1234567890'), isFalse);
      expect(UpiLinkValidator.isSafe('http://evil.example/pay'), isFalse);
    });

    test('rejects upi link without a payee (pa)', () {
      expect(UpiLinkValidator.isSafe('upi://pay?am=100&cu=INR'), isFalse);
    });

    test('rejects upi link whose amount mismatches the order', () {
      expect(
        UpiLinkValidator.isSafe(
          'upi://pay?pa=merchant@upi&am=99999&cu=INR',
          expectedAmount: '100.00',
        ),
        isFalse,
      );
    });

    test('allows a valid upi link with a matching amount', () {
      expect(
        UpiLinkValidator.isSafe(
          'upi://pay?pa=merchant@upi&am=100.00&cu=INR',
          expectedAmount: '100.00',
        ),
        isTrue,
      );
    });

    test('https links require a vetted host', () {
      expect(
        UpiLinkValidator.isSafe(
          'https://pay.truxify.example/upi',
          httpsHosts: <String>['pay.truxify.example'],
        ),
        isTrue,
      );
      expect(UpiLinkValidator.isSafe('https://evil.example/upi'), isFalse);
    });

    test('rejects a malicious injection-style deep link', () {
      expect(
        UpiLinkValidator.isSafe(
          'upi://pay?pa=attacker@upi&am=1&cu=INR;drop',
        ),
        isFalse,
      );
    });
  });
}
