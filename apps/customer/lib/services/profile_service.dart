import 'package:firebase_auth/firebase_auth.dart';
import '../core/api_client.dart';

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
    try {
      // Notify backend to invalidate server-side sessions/cache.
      await _apiClient.post('/api/auth/logout');
    } catch (e) {
      // Log error but proceed to sign out locally.
      // ignore: avoid_print
      print('Backend logout failed: $e');
    } finally {
      // Sign out from Firebase.
      await FirebaseAuth.instance.signOut();
    }
  }
}
