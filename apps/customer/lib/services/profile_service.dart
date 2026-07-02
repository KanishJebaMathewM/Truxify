import 'dart:convert';
import 'dart:developer' as developer;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_client.dart';
import 'supabase_service.dart';

class ProfileService {
  ProfileService({
    ApiClient? apiClient,
  }) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;
  static const String _profileCacheKey = 'truxify_profile_cache';

  Future<Map<String, dynamic>> fetchProfile() async {
    final prefs = await SharedPreferences.getInstance();
    try {
      final result = await _apiClient.get('/api/profile');
      if (result is Map<String, dynamic>) {
        await prefs.setString(_profileCacheKey, jsonEncode(result));
        return result;
      }
      return <String, dynamic>{};
    } on ApiException catch (e) {
      final cached = prefs.getString(_profileCacheKey);
      if (cached != null) {
        developer.log('API failed, returning cached profile.');
        return jsonDecode(cached) as Map<String, dynamic>;
      }
      throw StateError(e.message);
    } on FormatException {
      throw const FormatException('Invalid JSON response from server.');
    } catch (e) {
      final cached = prefs.getString(_profileCacheKey);
      if (cached != null) {
        developer.log('Network error, returning cached profile.');
        return jsonDecode(cached) as Map<String, dynamic>;
      }
      throw StateError('Failed to fetch profile via backend API: $e');
    }
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

    // Sign out from local clients
    await Future.wait([
      FirebaseAuth.instance.signOut(),
      SupabaseService.client.auth.signOut(),
    ]);
  }
}
