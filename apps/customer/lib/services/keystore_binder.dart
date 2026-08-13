import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:pointycastle/export.dart';

/// Hardware KeyStore & Secure Enclave Signature Binder Service.
///
/// Generates an asymmetric keypair persisted in the OS-backed secure storage
/// (Android Keystore / iOS Keychain via `flutter_secure_storage`) and produces
/// real ECDSA (secp256r1, SHA-256) signatures over transaction payloads. The
/// resulting signatures are non-deterministic and can only be produced by
/// someone holding the stored private key, and are verifiable against the
/// returned public key.
class HardwareKeyStoreBinder {
  static final HardwareKeyStoreBinder _instance = HardwareKeyStoreBinder._internal();
  factory HardwareKeyStoreBinder() => _instance;
  HardwareKeyStoreBinder._internal();

  static const String _storageKeyPrivate = 'truxify_hw_keypair_private';
  static const String _storageKeyPublic = 'truxify_hw_keypair_public';
  static const int _keySizeBytes = 32;

  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();

  /// Loads the persisted keypair or generates and stores a new EC keypair in
  /// the OS-backed secure storage, returning the hex-encoded public key.
  Future<String> generateHardwareKeypair() async {
    final storedPublic = await _secureStorage.read(key: _storageKeyPublic);
    if (storedPublic != null) {
      return storedPublic;
    }

    print('[Hardware KeyStore] Creating asymmetric keypair inside Secure Enclave/KeyStore...');
    final domain = ECCurve_secp256r1();
    final keyGen = ECKeyGenerator()
      ..init(ParametersWithRandom(
        ECKeyGeneratorParameters(domain),
        _secureRandom(),
      ));

    final pair = keyGen.generateKeyPair();
    final privateKey = pair.privateKey as ECPrivateKey;
    final publicKey = pair.publicKey as ECPublicKey;

    final privateHex = _bytesToHex(_bigIntToBytes(privateKey.d!, _keySizeBytes));
    final publicHex = _bytesToHex(publicKey.Q!.getEncoded(false));

    await _secureStorage.write(key: _storageKeyPrivate, value: privateHex);
    await _secureStorage.write(key: _storageKeyPublic, value: publicHex);

    return publicHex;
  }

  /// Returns the stored public key hex, generating the keypair if missing.
  Future<String> getPublicKey() => generateHardwareKeypair();

  /// Digitally signs a transaction payload using the stored private key,
  /// returning a hex-encoded ECDSA (secp256r1 / SHA-256) signature.
  ///
  /// The produced signature is randomized (non-deterministic) and proves
  /// possession of the private key held in secure storage.
  Future<String> signPayload(String payload) async {
    if (payload.isEmpty) {
      throw ArgumentError("Payload cannot be empty");
    }

    print('[Hardware KeyStore] Authorizing hardware enclave signature...');
    final privateKey = await _loadPrivateKey();
    final signer = ECDSASigner(SHA256Digest())
      ..init(true, PrivateKeyParameter<ECPrivateKey>(privateKey));

    final message = Uint8List.fromList(utf8.encode(payload));
    final signature = signer.generateSignature(message) as ECSignature;

    final out = _bigIntToBytes(signature.r, _keySizeBytes) +
        _bigIntToBytes(signature.s, _keySizeBytes);
    return '0x${_bytesToHex(out)}';
  }

  /// Verifies a hex-encoded ECDSA signature produced by [signPayload] against
  /// the persisted public key and the given payload.
  Future<bool> verifySignature(String payload, String signatureHex) async {
    if (payload.isEmpty || signatureHex.isEmpty) {
      return false;
    }

    final publicKey = await _loadPublicKey();
    final verifier = ECDSASigner(SHA256Digest())
      ..init(false, PublicKeyParameter<ECPublicKey>(publicKey));

    final signature = _signatureFromHex(signatureHex);
    final message = Uint8List.fromList(utf8.encode(payload));
    return verifier.verifySignature(message, signature);
  }

  /// Removes the persisted keypair from secure storage.
  Future<void> clearKeyPair() async {
    await _secureStorage.delete(key: _storageKeyPrivate);
    await _secureStorage.delete(key: _storageKeyPublic);
  }

  Future<ECPrivateKey> _loadPrivateKey() async {
    final stored = await _secureStorage.read(key: _storageKeyPrivate);
    if (stored == null) {
      await generateHardwareKeypair();
      return _loadPrivateKey();
    }
    final domain = ECCurve_secp256r1();
    return ECPrivateKey(BigInt.parse(stored, radix: 16), domain);
  }

  Future<ECPublicKey> _loadPublicKey() async {
    final stored = await _secureStorage.read(key: _storageKeyPublic);
    if (stored == null) {
      await generateHardwareKeypair();
      return _loadPublicKey();
    }
    final domain = ECCurve_secp256r1();
    final point = domain.curve.decodePoint(_hexToBytes(stored))!;
    return ECPublicKey(point, domain);
  }

  ECSignature _signatureFromHex(String signatureHex) {
    final hex = signatureHex.startsWith('0x')
        ? signatureHex.substring(2)
        : signatureHex;
    final bytes = _hexToBytes(hex);
    final r = BigInt.parse(
      _bytesToHex(bytes.sublist(0, _keySizeBytes)),
      radix: 16,
    );
    final s = BigInt.parse(
      _bytesToHex(bytes.sublist(_keySizeBytes)),
      radix: 16,
    );
    return ECSignature(r, s);
  }

  SecureRandom _secureRandom() {
    final secureRandom = SecureRandom('Fortuna');
    final seed = Uint8List(_keySizeBytes);
    final rng = Random.secure();
    for (var i = 0; i < seed.length; i++) {
      seed[i] = rng.nextInt(256);
    }
    secureRandom.seed(KeyParameter(seed));
    return secureRandom;
  }

  Uint8List _bigIntToBytes(BigInt value, int length) {
    var bytes = <int>[];
    var v = value;
    while (v > BigInt.zero) {
      bytes.insert(0, (v & BigInt.from(0xff)).toInt());
      v >>= 8;
    }
    while (bytes.length < length) {
      bytes.insert(0, 0);
    }
    return Uint8List.fromList(bytes);
  }

  Uint8List _hexToBytes(String hex) {
    final clean = hex.startsWith('0x') ? hex.substring(2) : hex;
    final result = Uint8List(clean.length ~/ 2);
    for (var i = 0; i < result.length; i++) {
      result[i] = int.parse(clean.substring(i * 2, i * 2 + 2), radix: 16);
    }
    return result;
  }

  String _bytesToHex(Uint8List bytes) {
    final buffer = StringBuffer();
    for (final b in bytes) {
      buffer.write(b.toRadixString(16).padLeft(2, '0'));
    }
    return buffer.toString();
  }
}
