import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:truxify/services/keystore_binder.dart';

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  test('generated public key is not a forgeable mock', () async {
    final binder = HardwareKeyStoreBinder();
    final pubKey = await binder.generateHardwareKeypair();

    expect(pubKey, isNotEmpty);
    expect(pubKey, isNot(startsWith('MOCK_HARDWARE_')));
  });

  test('signature is non-deterministic and verifies against public key', () async {
    final binder = HardwareKeyStoreBinder();
    final payload = 'TEST_TRANSACTION_PAYLOAD';

    final sig1 = await binder.signPayload(payload);
    final sig2 = await binder.signPayload(payload);

    // Randomized ECDSA: two signatures over the same payload must differ.
    expect(sig1, isNot(equals(sig2)));

    // Both must verify against the persisted public key.
    expect(await binder.verifySignature(payload, sig1), isTrue);
    expect(await binder.verifySignature(payload, sig2), isTrue);
  });

  test('signature does not verify for a tampered payload', () async {
    final binder = HardwareKeyStoreBinder();
    final sig = await binder.signPayload('ORIGINAL_PAYLOAD');

    expect(await binder.verifySignature('TAMPERED_PAYLOAD', sig), isFalse);
  });

  test('signing empty payload throws', () {
    final binder = HardwareKeyStoreBinder();
    expect(() => binder.signPayload(''), throwsArgumentError);
  });
}
