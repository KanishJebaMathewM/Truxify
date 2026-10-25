import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

class SecureAuthService {
  SecureAuthService({
    required String baseUrl,
  }) : _baseUrl = baseUrl;

  final String _baseUrl;

  // Platform-aware secure storage.
  //
  // Android/iOS:
  //   Uses the platform's secure storage mechanism.
  //
  // Web:
  //   Uses flutter_secure_storage's WebCrypto implementation.
  //   Credentials are encrypted before browser persistence.
  //
  // IMPORTANT:
  // Web deployment must use HTTPS (localhost is also supported).
  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    webOptions: WebOptions(
      dbName: 'TruxifyCustomerSecureStorage',
      publicKey: 'TruxifyCustomerWebCryptoKey',
      useSessionStorage: false,
    ),
  );

  static const String _accessTokenKey =
      'truxify_access_token';

  static const String _refreshTokenKey =
      'truxify_refresh_token';

  static const String _deviceIdKey =
      'truxify_device_id';

  // ---------------------------------------------------------------------------
  // SAVE TOKENS
  // ---------------------------------------------------------------------------

  Future<void> saveTokens(
    String accessToken,
    String refreshToken,
  ) async {
    await Future.wait([
      _storage.write(
        key: _accessTokenKey,
        value: accessToken,
      ),
      _storage.write(
        key: _refreshTokenKey,
        value: refreshToken,
      ),
    ]);
  }

  // ---------------------------------------------------------------------------
  // ACCESS TOKEN
  // ---------------------------------------------------------------------------

  Future<String?> getAccessToken() async {
    try {
      return await _storage.read(
        key: _accessTokenKey,
      );
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // REFRESH TOKEN
  // ---------------------------------------------------------------------------

  Future<String?> getRefreshToken() async {
    try {
      return await _storage.read(
        key: _refreshTokenKey,
      );
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // DEVICE ID
  // ---------------------------------------------------------------------------

  Future<String?> getDeviceId() async {
    try {
      return await _storage.read(
        key: _deviceIdKey,
      );
    } catch (e) {
      return null;
    }
  }

  Future<void> saveDeviceId(String deviceId) async {
    await _storage.write(
      key: _deviceIdKey,
      value: deviceId,
    );
  }

  // ---------------------------------------------------------------------------
  // CLEAR TOKENS
  // ---------------------------------------------------------------------------

  Future<void> clearTokens() async {
    await Future.wait([
      _storage.delete(
        key: _accessTokenKey,
      ),
      _storage.delete(
        key: _refreshTokenKey,
      ),
    ]);
  }

  // ---------------------------------------------------------------------------
  // CLEAR EVERYTHING
  // ---------------------------------------------------------------------------

  Future<void> clearAll() async {
    await Future.wait([
      _storage.delete(
        key: _accessTokenKey,
      ),
      _storage.delete(
        key: _refreshTokenKey,
      ),
      _storage.delete(
        key: _deviceIdKey,
      ),
    ]);
  }

  // ---------------------------------------------------------------------------
  // CHECK REFRESH TOKEN
  // ---------------------------------------------------------------------------

  Future<bool> hasRefreshToken() async {
    try {
      return await _storage.containsKey(
        key: _refreshTokenKey,
      );
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // RESTORE SESSION
  // ---------------------------------------------------------------------------

  /// Restores the customer session after:
  /// - application startup
  /// - browser refresh
  /// - browser reopening
  ///
  /// If an access token exists, it is returned.
  ///
  /// If no access token exists but a refresh token exists,
  /// token rotation is attempted automatically.
  Future<String?> restoreSession() async {
    final accessToken = await getAccessToken();

    if (accessToken != null && accessToken.isNotEmpty) {
      return accessToken;
    }

    final refreshed = await rotateTokensIfNeeded();

    if (!refreshed) {
      return null;
    }

    return getAccessToken();
  }

  // ---------------------------------------------------------------------------
  // TOKEN ROTATION
  // ---------------------------------------------------------------------------

  /// Refreshes the access token using the stored refresh token.
  ///
  /// On success:
  ///   - old access token is replaced
  ///   - old refresh token is replaced
  ///
  /// On 401:
  ///   - session is considered invalid
  ///   - credentials are removed
  ///
  /// On network failure:
  ///   - existing credentials are preserved
  ///   - user is not immediately logged out
  Future<bool> rotateTokensIfNeeded() async {
    final refreshToken = await getRefreshToken();

    if (refreshToken == null || refreshToken.isEmpty) {
      return false;
    }

    final deviceId =
        await getDeviceId() ?? 'unknown_device';

    try {
      final response = await http.post(
        Uri.parse(
          '$_baseUrl/api/auth/refresh',
        ),
        headers: const {
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'refreshToken': refreshToken,
          'deviceId': deviceId,
          'deviceInfo': 'Flutter Customer App',
        }),
      );

      // -----------------------------------------------------------------------
      // SUCCESS
      // -----------------------------------------------------------------------

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);

        final newAccessToken =
            data['accessToken'] as String?;

        final newRefreshToken =
            data['refreshToken'] as String?;

        // Never store incomplete credentials.
        if (newAccessToken == null ||
            newRefreshToken == null ||
            newAccessToken.isEmpty ||
            newRefreshToken.isEmpty) {
          await clearTokens();
          return false;
        }

        // Persist the rotated credentials securely.
        await saveTokens(
          newAccessToken,
          newRefreshToken,
        );

        return true;
      }

      // -----------------------------------------------------------------------
      // INVALID / EXPIRED REFRESH TOKEN
      // -----------------------------------------------------------------------

      if (response.statusCode == 401) {
        await clearTokens();
        return false;
      }

      // -----------------------------------------------------------------------
      // OTHER SERVER RESPONSE
      // -----------------------------------------------------------------------

      return false;
    } catch (_) {
      // Network/server failure should not automatically destroy
      // an otherwise valid refresh token.
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // LOGOUT
  // ---------------------------------------------------------------------------

  Future<void> logout() async {
    await clearAll();
  }
}
