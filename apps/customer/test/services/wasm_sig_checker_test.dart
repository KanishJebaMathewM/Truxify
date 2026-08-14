import 'package:flutter_test/flutter_test.dart';
import 'package:truxify/services/wasm_sig_checker.dart';

void main() {
  group('WasmSignatureChecker', () {
    test('is a singleton', () {
      expect(WasmSignatureChecker(), same(WasmSignatureChecker()));
    });

    test('rejects empty message', () {
      expect(
        WasmSignatureChecker().verifyOfflineSignature(
          message: '',
          signatureHex: 'a' * 64,
          publicKeyHex: 'b' * 32,
        ),
        isFalse,
      );
    });

    test('rejects empty signature', () {
      expect(
        WasmSignatureChecker().verifyOfflineSignature(
          message: 'order-123',
          signatureHex: '',
          publicKeyHex: 'b' * 32,
        ),
        isFalse,
      );
    });

    test('rejects empty public key', () {
      expect(
        WasmSignatureChecker().verifyOfflineSignature(
          message: 'order-123',
          signatureHex: 'a' * 64,
          publicKeyHex: '',
        ),
        isFalse,
      );
    });

    test('rejects short signatures', () {
      expect(
        WasmSignatureChecker().verifyOfflineSignature(
          message: 'order-123',
          signatureHex: 'a' * 63,
          publicKeyHex: 'b' * 32,
        ),
        isFalse,
      );
    });

    test('rejects short public keys', () {
      expect(
        WasmSignatureChecker().verifyOfflineSignature(
          message: 'order-123',
          signatureHex: 'a' * 64,
          publicKeyHex: 'b' * 31,
        ),
        isFalse,
      );
    });

    test('accepts signatures with adequate key and signature length', () {
      expect(
        WasmSignatureChecker().verifyOfflineSignature(
          message: 'order-123',
          signatureHex: 'a' * 64,
          publicKeyHex: 'b' * 32,
        ),
        isTrue,
      );
    });
  });
}
