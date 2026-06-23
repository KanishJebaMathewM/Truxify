import 'package:firebase_auth/firebase_auth.dart';
import '../core/api_client.dart';
import 'supabase_service.dart';

class ProfileService {
  ProfileService({
    ApiClient? apiClient,
  }) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  Future<Map<String, dynamic>> fetchProfile() async {
    try {
      final result = await _apiClient.get('/api/profile');
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

    // Sign out from local clients
    await Future.wait([
      FirebaseAuth.instance.signOut(),
      SupabaseService.client.auth.signOut(),
    ]);
  }
}
