import 'dart:convert';
import '../core/api_client.dart';
import 'supabase_service.dart';

class ProfileService {
  ProfileService({
    ApiClient? apiClient,
  }) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  Future<Map<String, dynamic>> fetchProfile() async {
    final userId = SupabaseService.requireUserId();
    final fullName = SupabaseService.currentUser?.userMetadata?['full_name']?.toString();

    final headers = <String, String>{
      'x-user-id': userId,
      'x-user-role': 'customer',
      if (fullName != null && fullName.isNotEmpty) 'x-user-name': fullName,
    };

    try {
      final result = await _apiClient.get('/api/profile', headers: headers);
      if (result is Map<String, dynamic>) {
        return result;
      }
      return <String, dynamic>{};
    } on ApiException catch (e) {
      throw StateError(e.message);
    } on FormatException {
      throw const FormatException('Invalid JSON response from server.');
    } catch (e) {
      throw StateError('Failed to fetch profile via backend API: $e');
    }
  }

  Future<void> logout() async {
    final token = _client.auth.currentSession?.accessToken;
    final userId = _client.auth.currentUser?.id;

    if (token == null || token.isEmpty || userId == null) {
      await _client.auth.signOut();
      return;
    }

    try {
      await _httpClient.post(
        Uri.parse('$_apiBaseUrl/api/auth/logout'),
        headers: <String, String>{
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
          'x-user-id': userId,
          'x-user-role': 'customer',
        },
      ).timeout(const Duration(seconds: 5));
    } catch (e) {
      // Log error but proceed to sign out locally
      print('Backend logout failed: $e');
    } finally {
      await _client.auth.signOut();
    }
  }
}
