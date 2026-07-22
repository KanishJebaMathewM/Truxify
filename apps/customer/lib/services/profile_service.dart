import 'dart:convert';
import 'dart:developer' as developer;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_client.dart';
import 'fcm_service.dart';
import 'supabase_service.dart';

class ProfileService {
  ProfileService({
    ApiClient? apiClient,
  }) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;
  static const String _profileCacheKey = 'truxify_profile_cache';

  Future<Map<String, dynamic>?> _readCachedProfile(
    SharedPreferences prefs,
  ) async {
    final cached = prefs.getString(_profileCacheKey);
    if (cached == null) return null;
    try {
      final decoded = jsonDecode(cached);
      if (decoded is Map<String, dynamic>) return decoded;
    } catch (_) {
      // Invalid cache entries are cleared so future fallbacks do not crash.
    }
    await prefs.remove(_profileCacheKey);
    return null;
  }

  Future<Map<String, dynamic>> fetchProfile() async {
    final prefs = await SharedPreferences.getInstance();
    try {
      final result = await _apiClient.get('/api/profile');
      if (result is Map<String, dynamic>) {
        await prefs.setString(_profileCacheKey, jsonEncode(result));
        return result;
      }
      throw StateError('Expected profile object but received ${result.runtimeType}');
    } on ApiException catch (e) {
      final cached = await _readCachedProfile(prefs);
      if (cached != null) {
        developer.log('API failed, returning cached profile.');
        return cached;
      }
      throw StateError(e.message);
    } on FormatException {
      throw const FormatException('Invalid JSON response from server.');
    } catch (e) {
      final cached = await _readCachedProfile(prefs);
      if (cached != null) {
        developer.log('Network error, returning cached profile.');
        return cached;
      }
      throw StateError('Failed to fetch profile via backend API: $e');
    }
  }


  Future<Map<String, dynamic>?> fetchCustomerStats() async {
    try {
      final result = await _apiClient.get('/api/profile/customer-stats');
      if (result is Map<String, dynamic>) {
        return result['stats'] as Map<String, dynamic>?;
      }
      return null;
    } on ApiException catch (e) {
      developer.log('Failed to fetch customer stats: ${e.message}');
      return null;
    } catch (e) {
      developer.log('Unexpected error fetching customer stats: $e');
      return null;
    }
  }

  Future<void> updateProfile({
    required String fullName,
    required String companyName,
    required String phone,
  }) async {
    await _apiClient.put(
      '/api/profile',
      body: <String, String>{
        'full_name': fullName,
        'company_name': companyName,
        'phone': phone,
      },
    );
  }

  Future<void> logout() async {
    final userId = FirebaseAuth.instance.currentUser?.uid ?? SupabaseService.client.auth.currentUser?.id;

    if (userId != null) {
      try {
        await _apiClient.post(
          '/api/auth/logout',
        );
      } catch (e) {
        // ignore: avoid_print
        developer.log('Backend logout failed: $e');
      }
    }

    // Unregister this device's FCM token first so a signed-out device stops
    // receiving push notifications intended for the next user of a shared
    // device, then sign out from local clients.
    try {
      await FcmService.unregisterToken();
    } catch (e) {
      developer.log('FCM token unregister failed during logout: $e');
    }

    await Future.wait([
      FirebaseAuth.instance.signOut(),
      SupabaseService.client.auth.signOut(),
    ]);
  }
}
