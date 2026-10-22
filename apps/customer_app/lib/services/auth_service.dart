// apps/customer_app/lib/services/auth_service.dart (Excerpt)

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  // Create secure storage instance with encrypted shared preferences enabled for Android
  final _secureStorage = const FlutterSecureStorage(
    aOptions: AndroidOptions(
      encryptedSharedPreferences: true,
    ),
  );

  static const String _accessTokenKey = 'access_token';
  static const String _refreshTokenKey = 'refresh_token';

  /// Save tokens securely
  Future<void> saveTokens({required String accessToken, required String refreshToken}) async {
    await _secureStorage.write(key: _accessTokenKey, value: accessToken);
    await _secureStorage.write(key: _refreshTokenKey, value: refreshToken);
  }

  /// Retrieve access token
  Future<String?> getAccessToken() async {
    return await _secureStorage.read(key: _accessTokenKey);
  }

  /// Retrieve refresh token
  Future<String?> getRefreshToken() async {
    return await _secureStorage.read(key: _refreshTokenKey);
  }

  /// Secure deletion on logout
  Future<void> logout() async {
    await _secureStorage.deleteAll();
  }
}
