import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'services/auth_storage_service.dart';

class SecureStorage {
  static const FlutterSecureStorage _nativeStorage = FlutterSecureStorage();

  /// Writes a secure key-value pair, encrypting on Web via AuthStorageService.
  static Future<void> write({required String key, required String value}) async {
    if (kIsWeb) {
      await AuthStorageService.encryptAndStore(key, value);
    } else {
      await _nativeStorage.write(key: key, value: value);
    }
  }

  /// Reads a secure key-value pair, decrypting on Web.
  static Future<String?> read({required String key}) async {
    if (kIsWeb) {
      return await AuthStorageService.retrieveAndDecrypt(key);
    } else {
      return await _nativeStorage.read(key: key);
    }
  }

  /// Deletes a stored secure key.
  static Future<void> delete({required String key}) async {
    if (kIsWeb) {
      await AuthStorageService.remove(key);
    } else {
      await _nativeStorage.delete(key: key);
    }
  }

  /// Purges all secure credentials (used on logout).
  static Future<void> deleteAll() async {
    if (kIsWeb) {
      await AuthStorageService.clearAll();
    } else {
      await _nativeStorage.deleteAll();
    }
  }
}
