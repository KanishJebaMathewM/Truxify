import 'package:firebase_auth/firebase_auth.dart';
import '../core/api_client.dart';
import 'supabase_service.dart';

class ProfileService {
  ProfileService({
    ApiClient? apiClient,
  }) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;
  Map<String, dynamic>? _cachedProfile;

  Future<Map<String, dynamic>> fetchProfile({bool forceRefresh = false}) async {
    if (!forceRefresh && _cachedProfile != null) {
      return _cachedProfile!;
    }
    try {
      final result = await _apiClient.get('/api/profile');
      if (result is Map<String, dynamic>) {
        _cachedProfile = result;
        return result;
      }
      return <String, dynamic>{};
    } on ApiException catch (e) {
      if (_cachedProfile != null) return _cachedProfile!;
      throw StateError(e.message);
    } on FormatException {
      throw const FormatException('Invalid JSON response from server.');
    } catch (e) {
      if (_cachedProfile != null) return _cachedProfile!;
      throw StateError('Failed to fetch profile via backend API: $e');
    }
  }

  Future<Map<String, dynamic>> updateProfile(Map<String, dynamic> updates) async {
    try {
      final result = await _apiClient.put('/api/profile', body: updates);
      if (result is Map<String, dynamic>) {
        _cachedProfile = {...?_cachedProfile, ...result};
        return result;
      }
      throw StateError('Unexpected response format');
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to update profile: $e');
    }
  }

  Future<bool> deleteAccount() async {
    try {
      await _apiClient.delete('/api/profile');
      _cachedProfile = null;
      return true;
    } catch (_) {
      return false;
    }
  }

  String? get displayName => _cachedProfile?['full_name'] as String?;
  String? get email => _cachedProfile?['email'] as String?;
  String? get phone => _cachedProfile?['phone'] as String?;
  String? get avatarUrl => _cachedProfile?['avatar_url'] as String?;

  void clearCache() {
    _cachedProfile = null;
  }

  Future<void> logout() async {
    _cachedProfile = null;
    final userId = FirebaseAuth.instance.currentUser?.uid ?? SupabaseService.client.auth.currentUser?.id;

    if (userId != null) {
      try {
        await _apiClient.post(
          '/api/auth/logout',
          headers: <String, String>{
            'x-user-id': userId,
            'x-user-role': 'customer',
          },
        );
      } catch (e) {
        // ignore: avoid_print
        print('Backend logout failed: $e');
      }
    }

    await Future.wait([
      FirebaseAuth.instance.signOut(),
      SupabaseService.client.auth.signOut(),
    ]);
  }
}
