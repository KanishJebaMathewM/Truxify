// apps/customer/lib/services/auth_service.dart (Excerpt)
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final _secureStorage = const FlutterSecureStorage();

  Future<void> storeSessionToken(String token) async {
    await _secureStorage.write(key: 'truxify_auth_token', value: token);
  }

  Future<String?> getStoredSessionToken() async {
    return await _secureStorage.read(key: 'truxify_auth_token');
  }

  Future<bool> restoreSessionWithBiometrics() async {
    final token = await getStoredSessionToken();
    if (token == null || token.isEmpty) return false;

    // Validate token against backend or restore local session state
    // ...
    return true;
  }

  Future<void> clearSession() async {
    await _secureStorage.delete(key: 'truxify_auth_token');
  }
}
