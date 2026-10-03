import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

class SecureAuthService {
  static const _storage = FlutterSecureStorage();
  static const _accessTokenKey = 'truxify_access_token';
  static const _refreshTokenKey = 'truxify_refresh_token';
  static const _deviceIdKey = 'truxify_device_id';
  
  final String _baseUrl;

  SecureAuthService({required String baseUrl}) : _baseUrl = baseUrl;

  Future<void> saveTokens(String accessToken, String refreshToken) async {
    await _storage.write(key: _accessTokenKey, value: accessToken);
    await _storage.write(key: _refreshTokenKey, value: refreshToken);
  }

  Future<String?> getAccessToken() async {
    return await _storage.read(key: _accessTokenKey);
  }

  Future<String?> getRefreshToken() async {
    return await _storage.read(key: _refreshTokenKey);
  }

  Future<void> clearTokens() async {
    await _storage.delete(key: _accessTokenKey);
    await _storage.delete(key: _refreshTokenKey);
  }

  Future<bool> rotateTokensIfNeeded() async {
    final refreshToken = await getRefreshToken();
    final deviceId = await _storage.read(key: _deviceIdKey) ?? 'unknown_device';

    if (refreshToken == null) return false;

    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/api/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'refreshToken': refreshToken,
          'deviceId': deviceId,
          'deviceInfo': 'Flutter Mobile App',
        }),
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        await saveTokens(data['accessToken'], data['refreshToken']);
        return true;
      } else if (response.statusCode == 401) {
        await clearTokens();
        return false;
      }
    } catch (e) {
      print('Error rotating tokens: $e');
    }
    return false;
  }
}
