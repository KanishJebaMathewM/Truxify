import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:pointycastle/export.dart';

/// Hardware KeyStore Signature Binder Service.
///
/// Generates an asymmetric keypair inside the OS-backed hardware keystore
/// (Android Keystore) and produces real ECDSA (secp256r1, SHA-256) signatures
/// over transaction payloads. The private key is generated *inside* the
/// hardware keystore and is non-exportable: it never leaves the secure
/// hardware and is never materialized as plaintext in the Dart process or in
/// application storage. Signing is performed by the OS keystore itself, so a
/// signature can only be produced by the hardware holding the key. The
/// resulting signatures are non-deterministic and are verifiable against the
/// returned public key.
class HardwareKeyStoreBinder {
  static final HardwareKeyStoreBinder _instance = HardwareKeyStoreBinder._internal();
  factory HardwareKeyStoreBinder() => _instance;
  HardwareKeyStoreBinder._internal();

  static const MethodChannel _channel = MethodChannel('com.truxify.customer/native');

  /// Fixed alias under which the hardware keystore holds the non-exportable key.
  static const String _keyAlias = 'truxify_hw_keypair';

  /// Ensures an EC keypair exists inside the hardware keystore and returns the
  /// hex-encoded (uncompressed, 0x04|x|y) public key. The private key is
  /// generated and stored inside the hardware keystore and is never returned.
  Future<String> generateHardwareKeypair() async {
    final publicKey = await _channel.invokeMethod<String>(
      'hwGenerateKeyPair',
      {'alias': _keyAlias},
    );
    if (publicKey == null) {
      throw StateError('Hardware KeyStore unavailable: failed to generate keypair');
    }
    return publicKey;
  }

  /// Returns the stored public key hex, generating the keypair if missing.
  Future<String> getPublicKey() => generateHardwareKeypair();

  /// Digitally signs a transaction payload using the hardware keystore private
  /// key, returning a hex-encoded ECDSA (secp256r1 / SHA-256) signature.
  ///
  /// The actual signing happens inside the OS hardware keystore; the private
  /// key material is never exposed to Dart. The produced signature is
  /// randomized (non-deterministic).
  Future<String> signPayload(String payload) async {
    if (payload.isEmpty) {
      throw ArgumentError("Payload cannot be empty");
    }

    final signature = await _channel.invokeMethod<String>(
      'hwSign',
      {'alias': _keyAlias, 'payload': payload},
    );
    if (signature == null) {
      throw StateError('Hardware KeyStore signing failed');
    }
    return '0x$signature';
  }

  /// Verifies a hex-encoded ECDSA signature produced by [signPayload] against
  /// the persisted public key and the given payload. Verification uses only
  /// the public key (which is not secret), so it is performed in Dart.
  Future<bool> verifySignature(String payload, String signatureHex) async {
    if (payload.isEmpty || signatureHex.isEmpty) {
      return false;
    }

    try {
      final publicKeyHex = await getPublicKey();
      final domain = ECCurve_secp256r1();
      final point = domain.curve.decodePoint(_hexToBytes(publicKeyHex))!;
      final publicKey = ECPublicKey(point, domain);

      final verifier = ECDSASigner(SHA256Digest())
        ..init(false, PublicKeyParameter<ECPublicKey>(publicKey));

      final signature = _signatureFromDer(signatureHex);
      final message = Uint8List.fromList(utf8.encode(payload));
      return verifier.verifySignature(message, signature);
    } catch (_) {
      return false;
    }
  }

  /// Removes the hardware keystore entry for the keypair.
  Future<void> clearKeyPair() async {
    await _channel.invokeMethod<void>(
      'hwClearKeyPair',
      {'alias': _keyAlias},
    );
  }

  /// Parses a DER-encoded ECDSA signature (as produced by the Android
  /// Keystore's `SHA256withECDSA` signer) into an [ECSignature].
  ECSignature _signatureFromDer(String signatureHex) {
    final hex = signatureHex.startsWith('0x')
        ? signatureHex.substring(2)
        : signatureHex;
    final der = _hexToBytes(hex);
    final sequence = ASN1Parser(der).nextObject() as ASN1Sequence;
    final r = (sequence.elements[0] as ASN1Integer).integer!;
    final s = (sequence.elements[1] as ASN1Integer).integer!;
    return ECSignature(r, s);
  }

  Uint8List _hexToBytes(String hex) {
    final clean = hex.startsWith('0x') ? hex.substring(2) : hex;
    final result = Uint8List(clean.length ~/ 2);
    for (var i = 0; i < result.length; i++) {
      result[i] = int.parse(clean.substring(i * 2, i * 2 + 2), radix: 16);
    }
    return result;
  }
}
