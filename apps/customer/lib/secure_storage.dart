import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Platform-aware secure storage.
///
/// Android/iOS use the platform keystores; web uses flutter_secure_storage's
/// WebCrypto implementation (credentials are encrypted before browser
/// persistence — HTTPS required in production). The previous web branch
/// referenced a phantom AuthStorageService class that does not exist in the
/// codebase; flutter_secure_storage covers all platforms directly.
class SecureStorage {
  static const FlutterSecureStorage _nativeStorage = FlutterSecureStorage(
    webOptions: WebOptions(
      dbName: 'TruxifyCustomerSecureStorage',
      publicKey: 'TruxifyCustomerWebCryptoKey',
      useSessionStorage: false,
    ),
  );

  /// Writes a secure key-value pair (encrypted at rest on every platform).
  static Future<void> write({required String key, required String value}) {
    return _nativeStorage.write(key: key, value: value);
  }

  /// Reads a secure key-value pair.
  static Future<String?> read({required String key}) {
    return _nativeStorage.read(key: key);
  }

  /// Deletes a stored secure key.
  static Future<void> delete({required String key}) {
    return _nativeStorage.delete(key: key);
  }

  /// Purges all secure credentials (used on logout).
  static Future<void> deleteAll() {
    return _nativeStorage.deleteAll();
  }
}
