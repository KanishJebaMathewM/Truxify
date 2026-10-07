import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'services/auth_storage_service.dart';

class SecureStorage {
  static const FlutterSecureStorage _nativeStorage = FlutterSecureStorage();

  /// Saves key-value securely: AES-GCM encrypted on Web, Keychain/KeyStore on Mobile.
  static Future<void> save(String key, String value) async {
    if (kIsWeb) {
      await AuthStorageService.encryptAndStore(key, value);
    } else {
      await _nativeStorage.write(key: key, value: value);
    }
  }

  /// Reads key securely: Decrypts from Web storage, or reads from Mobile Keychain/KeyStore.
  static Future<String?> read(String key) async {
    if (kIsWeb) {
      return await AuthStorageService.retrieveAndDecrypt(key);
    } else {
      return await _nativeStorage.read(key: key);
    }
  }

  /// Deletes a specific stored key.
  static Future<void> delete(String key) async {
    if (kIsWeb) {
      await AuthStorageService.remove(key);
    } else {
      await _nativeStorage.delete(key: key);
    }
  }

  /// Purges all stored secure credentials (used during user logout).
  static Future<void> deleteAll() async {
    if (kIsWeb) {
      await AuthStorageService.clearAll();
    } else {
      await _nativeStorage.deleteAll();
    }
  }
}
