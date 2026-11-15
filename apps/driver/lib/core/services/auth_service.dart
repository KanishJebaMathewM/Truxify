// apps/driver/lib/core/services/auth_service.dart (and apps/customer/lib/core/services/auth_service.dart)

import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  // Configure secure storage with Android encrypted shared preferences enabled
  static const _secureStorage = FlutterSecureStorage(
    aOptions: AndroidOptions(
      encryptedSharedPreferences: true,
    ),
  );

  static const String _accessTokenKey = 'access_token';
  static const String _refreshTokenKey = 'refresh_token';
  static const String _migratedKey = 'tokens_migrated_to_secure_storage';

  /// Performs one-time migration of plaintext tokens from SharedPreferences to FlutterSecureStorage
  Future<void> migrateTokensIfNeeded() async {
    final prefs = await SharedPreferences.getInstance();
    final isMigrated = prefs.getBool(_migratedKey) ?? false;

    if (!isMigrated) {
      // 1. Read legacy insecure tokens
      final legacyAccessToken = prefs.getString(_accessTokenKey);
      final legacyRefreshToken = prefs.getString(_refreshTokenKey);

      // 2. Write to secure storage if present
      if (legacyAccessToken != null) {
        await _secureStorage.write(key: _accessTokenKey, value: legacyAccessToken);
      }
      if (legacyRefreshToken != null) {
        await _secureStorage.write(key: _refreshTokenKey, value: legacyRefreshToken);
      }

      // 3. Purge insecure legacy tokens from SharedPreferences
      await prefs.remove(_accessTokenKey);
      await prefs.remove(_refreshTokenKey);
      await prefs.setBool(_migratedKey, true);
    }
  }

  /// Store tokens securely
  Future<void> saveTokens({required String accessToken, required String refreshToken}) async {
    await _secureStorage.write(key: _accessTokenKey, value: accessToken);
    await _secureStorage.write(key: _refreshTokenKey, value: refreshToken);
  }

  /// Retrieve access token securely
  Future<String?> getAccessToken() async {
    await migrateTokensIfNeeded();
    return await _secureStorage.read(key: _accessTokenKey);
  }

  /// Retrieve refresh token securely
  Future<String?> getRefreshToken() async {
    await migrateTokensIfNeeded();
    return await _secureStorage.read(key: _refreshTokenKey);
  }

  /// Securely delete tokens on logout
  Future<void> logout() async {
    await _secureStorage.deleteAll();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_migratedKey);
  }
}
