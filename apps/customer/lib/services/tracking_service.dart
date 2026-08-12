import '../core/api_client.dart';

class TrackingService {
  TrackingService({
    ApiClient? apiClient,
  }) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  String _encodePathSegment(String value) => Uri.encodeComponent(value);

  /// Generates a shareable tracking link for the given order.
  /// Returns a Map with `trackingUrl`, `token`, and `expiresAt`.
  Future<Map<String, dynamic>> shareTrackingLink({
    required String orderDisplayId,
  }) async {
    try {
      final body = await _apiClient.post(
        '/api/orders/${_encodePathSegment(orderDisplayId)}/share-tracking',
        body: <String, dynamic>{},
      );
      return body is Map<String, dynamic> ? body : <String, dynamic>{};
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to generate tracking link: $e');
    }
  }

  /// Revokes all active tracking tokens for the given order.
  Future<void> revokeTrackingLink({
    required String orderDisplayId,
  }) async {
    try {
      await _apiClient.post(
        '/api/orders/${_encodePathSegment(orderDisplayId)}/share-tracking/revoke',
        body: <String, dynamic>{},
      );
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to revoke tracking link: $e');
    }
  }

  /// Fetches public tracking data (no auth required).
  /// Returns order, timeline, and driver_location.
  Future<Map<String, dynamic>?> fetchPublicTracking(String token) async {
    try {
      final body = await _apiClient.get(
        '/api/public/tracking/${_encodePathSegment(token)}',
      );
      return body is Map<String, dynamic> ? body : null;
    } on ApiException catch (e) {
      if (e.statusCode == 404 || e.statusCode == 410) return null;
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to fetch tracking data: $e');
    }
  }

  /// Fetches public route geometry for a tracked order.
  Future<Map<String, dynamic>?> fetchPublicRoute(String token) async {
    try {
      final body = await _apiClient.get(
        '/api/public/tracking/${_encodePathSegment(token)}/route',
      );
      return body is Map<String, dynamic> ? body : null;
    } on ApiException catch (e) {
      if (e.statusCode == 404) return null;
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to fetch route data: $e');
    }
  }
}
