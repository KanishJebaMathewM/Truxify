import 'dart:convert';
import 'dart:developer' as developer;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../core/api_client.dart';
import 'fcm_service.dart';
import 'supabase_service.dart';

/// Secure profile cache using [FlutterSecureStorage] instead of
/// [SharedPreferences]. Profile data contains PII (name, phone, email)
/// and must not be stored in plaintext on-device storage.
///
/// On Android: stored in EncryptedSharedPreferences (AES-256, AndroidKeyStore).
/// On iOS: stored in the Keychain (hardware-backed on supported devices).
class ProfileService {
  ProfileService({
    ApiClient? apiClient,
    FlutterSecureStorage? secureStorage,
  })  : _apiClient = apiClient ?? ApiClient(),
        _secureStorage = secureStorage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
            );

  final ApiClient _apiClient;
  final FlutterSecureStorage _secureStorage;

  static const String _profileCacheKey = 'truxify_profile_cache';

  Future<Map<String, dynamic>?> _readCachedProfile(
    SharedPreferences prefs,
  ) async {
    final cached = await _secureStorage.read(key: _profileCacheKey);
    if (cached == null) return null;
    try {
      final decoded = jsonDecode(cached);
      if (decoded is Map<String, dynamic>) return decoded;
    } catch (_) {
      // Invalid cache entries are cleared so future fallbacks do not crash.
    }
    await _secureStorage.delete(key: _profileCacheKey);
    return null;
  }

  Future<Map<String, dynamic>> fetchProfile() async {
    try {
      final result = await _apiClient.get('/api/profile');
      if (result is Map<String, dynamic>) {
        // Cache profile securely — data contains PII
        await _secureStorage.write(
          key: _profileCacheKey,
          value: jsonEncode(result),
        );
        return result;
      }
      return <String, dynamic>{};
    } on ApiException catch (e) {
      final cached = await _readCachedProfile();
      if (cached != null) {
        developer.log('API failed, returning cached profile.');
        return cached;
      }
      throw StateError(e.message);
    } on FormatException {
      throw const FormatException('Invalid JSON response from server.');
    } catch (e) {
      final cached = await _readCachedProfile();
      if (cached != null) {
        developer.log('Network error, returning cached profile.');
        return cached;
      }
      throw StateError('Failed to fetch profile via backend API: $e');
    }
  }

  /// Clears the secure profile cache on logout — prevents stale PII
  /// remaining on-device after session ends.
  Future<void> clearProfileCache() async {
    await _secureStorage.delete(key: _profileCacheKey);
  }

  Future<void> logout() async {
    final userId = FirebaseAuth.instance.currentUser?.uid ??
        SupabaseService.client.auth.currentUser?.id;

    if (userId != null) {
      try {
        await _apiClient.post('/api/auth/logout');
      } catch (e) {
        developer.log('Backend logout failed: $e');
      }
    }

    // Clear cached PII before signing out
    await clearProfileCache();

    // Unregister this device's FCM token first so a signed-out device stops
    // receiving push notifications intended for the next user of a shared
    // device, then sign out from local clients.
    await FcmService.unregisterToken();

    // Sign out from local clients
    await Future.wait([
      FirebaseAuth.instance.signOut(),
      SupabaseService.client.auth.signOut(),
    ]);
  }
}
