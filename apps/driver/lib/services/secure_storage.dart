import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Thin wrapper around [FlutterSecureStorage] so the driver app persists
/// long-lived credentials in OS-backed secure storage instead of plaintext
/// SharedPreferences (issue #5739).
class SecureStorage {
  static const _storage = FlutterSecureStorage();

  static Future<void> save(String key, String value) async {
    await _storage.write(key: key, value: value);
  }

  static Future<String?> read(String key) async {
    return await _storage.read(key: key);
  }

  static Future<void> delete(String key) async {
    await _storage.delete(key: key);
  }
}

/// Well-known secure storage keys used across the driver app.
class SecureStorageKeys {
  SecureStorageKeys._();

  /// Auth token used by background sync and WebSocket reconnects when
  /// Firebase/Supabase are not reachable in a background isolate.
  static const String authToken = 'auth_token';
}

/// Persists the current auth token to secure storage so background sync and
/// WebSocket reconnects can read it without keeping the token in plaintext.
class AuthTokenStore {
  AuthTokenStore._();

  static String? _lastPersisted;

  /// Persists [token] to secure storage, skipping redundant writes when the
  /// value has not changed since the last successful save.
  static Future<void> persist(String? token) async {
    if (token == null || token.isEmpty) return;
    if (token == _lastPersisted) return;
    _lastPersisted = token;
    await SecureStorage.save(SecureStorageKeys.authToken, token);
  }

  static Future<String?> read() {
    return SecureStorage.read(SecureStorageKeys.authToken);
  }

  static Future<void> clear() {
    _lastPersisted = null;
    return SecureStorage.delete(SecureStorageKeys.authToken);
  }
}
