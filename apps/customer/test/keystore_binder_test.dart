import 'dart:async';

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pointycastle/export.dart';
import 'package:pointycastle/asn1/primitives/asn1_integer.dart';
import 'package:pointycastle/asn1/primitives/asn1_sequence.dart';
import 'package:truxify/services/keystore_binder.dart';

String _hex(Uint8List bytes) =>
    bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();

    // The hardware channel has no implementation in tests. Back it with a
    // REAL software secp256r1 keypair (pointycastle — the same library the
    // verifier uses) so these tests exercise genuine ECDSA: randomized
    // signatures that verify — not forgeable mock strings.
    final domain = ECCurve_secp256r1();
    AsymmetricKeyPair<ECPublicKey, ECPrivateKey>? keyPair;
    int seedCounter = 0;
    SecureRandom freshRandom() {
      final seed = Uint8List(32);
      for (var i = 0; i < 32; i++) {
        seed[i] = (++seedCounter * 31 + i * 7 + 13) & 0xff;
      }
      return SecureRandom('Fortuna')..seed(KeyParameter(seed));
    }

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('com.truxify.customer/native'),
      (call) async {
        switch (call.method) {
          case 'hwGenerateKeyPair':
            // Hardware keystores persist the alias — return the existing
            // keypair rather than regenerating (verify must see the same
            // public key that signed).
            if (keyPair != null) {
              final q = (keyPair!.publicKey as ECPublicKey).Q!;
              return _hex(q.getEncoded(false));
            }
            final gen = ECKeyGenerator()
              ..init(ParametersWithRandom(
                  ECKeyGeneratorParameters(domain), freshRandom()));
            final pair = gen.generateKeyPair();
            keyPair = AsymmetricKeyPair<ECPublicKey, ECPrivateKey>(
                pair.publicKey as ECPublicKey, pair.privateKey as ECPrivateKey);
            final q = (keyPair!.publicKey as ECPublicKey).Q!;
            return _hex(q.getEncoded(false)); // uncompressed 0x04|x|y
          case 'hwSign':
            final payload = (call.arguments as Map)['payload'] as String;
            final signer = ECDSASigner(SHA256Digest())
              ..init(
                  true,
                  ParametersWithRandom(PrivateKeyParameter(keyPair!.privateKey),
                      freshRandom()));
            final sig = signer
                    .generateSignature(Uint8List.fromList(utf8.encode(payload)))
                as ECSignature;
            final der = ASN1Sequence(elements: [
              ASN1Integer(sig.r),
              ASN1Integer(sig.s),
            ]).encode();
            return _hex(der);
          case 'hwClearKeyPair':
            keyPair = null;
            return null;
        }
        return null;
      },
    );
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
