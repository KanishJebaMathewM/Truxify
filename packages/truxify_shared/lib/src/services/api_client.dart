import 'dart:async';
import 'dart:convert';
import 'dart:ui' as ui;
import 'dart:developer' as developer;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/app_config.dart';
import 'http_client_factory.dart';

/// Exception thrown when an API request fails after token refresh.
class ApiAuthException implements Exception {
  const ApiAuthException(this.message);
  final String message;
  @override
  String toString() => 'ApiAuthException: $message';
}

/// Exception thrown when an API request returns a non-2xx response.
class ApiException implements Exception {
  const ApiException(this.statusCode, this.message, {this.body});
  final int statusCode;
  final String message;
  final String? body;
  @override
  String toString() => 'ApiException($statusCode): $message';
}

/// Centralised API client for all Truxify backend requests.
///
/// Responsibilities:
///   - Reads the current Supabase session access token.
///   - Injects `Authorization: Bearer <accessToken>` into every request.
///   - On HTTP 401, attempts `supabase.auth.refreshSession()` once and retries.
///   - If the retry still returns 401, throws [ApiAuthException].
///   - Logs failures in debug mode via `dart:developer`.
///
/// Usage:
/// ```dart
/// final client = ApiClient();
/// final data = await client.get('/api/orders');
/// ```
class ApiClient {
  ApiClient({
    SupabaseClient? supabaseClient,
    http.Client? httpClient,
    String? baseUrl,
    Duration? timeout,
  })  : _providedSupabase = supabaseClient,
        _isClientOwned = httpClient == null,
        _http = httpClient ?? createHttpClient(),
        _baseUrl = _normalise(_getBaseUrl(baseUrl)),
        _timeout = timeout ?? AppConfig.apiTimeout;

  final SupabaseClient? _providedSupabase;
  SupabaseClient get _supabase => _providedSupabase ?? Supabase.instance.client;
  final http.Client _http;
  final bool _isClientOwned;
  final String _baseUrl;
  final Duration _timeout;

  static String _getBaseUrl(String? overrideUrl) {
    if (overrideUrl != null) return overrideUrl;
    const envUrl = String.fromEnvironment('TRUXIFY_API_BASE_URL');
    if (envUrl.isNotEmpty) return envUrl;
    if (kReleaseMode) {
      developer.log(
        '[ApiClient] TRUXIFY_API_BASE_URL not set — falling back to localhost. '
        'Set --dart-define=TRUXIFY_API_BASE_URL=<url> for production builds.',
      );
    }
    return defaultBaseUrl;
  }

  static String get defaultBaseUrl {
    const envUrl = String.fromEnvironment('TRUXIFY_API_BASE_URL');
    if (envUrl.isNotEmpty) return envUrl;
    if (kReleaseMode) throw StateError('TRUXIFY_API_BASE_URL must be set in release mode');
    return 'http://localhost:5000';
  }

  static String _normalise(String url) =>
      url.endsWith('/') ? url.substring(0, url.length - 1) : url;

  // ── Token helpers ─────────────────────────────────────────────────

  /// Firebase ID token for authenticated API requests.
  /// Falls back to Supabase session token if no Firebase user is signed in.
  String? _cachedFirebaseToken;

  Future<String?> get _accessTokenAsync async {
    try {
      final firebaseUser = FirebaseAuth.instance.currentUser;
      if (firebaseUser != null) {
        _cachedFirebaseToken = await firebaseUser.getIdToken();
        return _cachedFirebaseToken;
      }
    } catch (_) {
      // Firebase not initialised; fall through to Supabase session
    }
    _cachedFirebaseToken = null;
    return _supabase.auth.currentSession?.accessToken;
  }

  String? get _accessToken {
    if (_cachedFirebaseToken != null) return _cachedFirebaseToken;
    try {
      return _supabase.auth.currentSession?.accessToken;
    } catch (_) {
      return null;
    }
  }

  Map<String, String> _headers({String? token, Map<String, String>? additionalHeaders}) {
    final t = token ?? _accessToken;
    return <String, String>{
      'Content-Type': 'application/json',
      'Accept-Language': ui.PlatformDispatcher.instance.locale.languageCode,
      if (t != null && t.isNotEmpty) 'Authorization': 'Bearer $t',
      ...?additionalHeaders,
    };
  }

  Future<String?> _refreshedToken() async {
    try {
      final firebaseUser = FirebaseAuth.instance.currentUser;
      if (firebaseUser != null) {
        final token = await firebaseUser.getIdToken(true);
        _cachedFirebaseToken = token;
        return token;
      }
    } catch (e) {
      if (kDebugMode) {
        developer.log(
          '[ApiClient] Firebase token refresh failed: $e',
          name: 'ApiClient',
        );
      }
    }

    try {
      // Fall back to Supabase session refresh.
      final res = await _supabase.auth.refreshSession();
      return res.session?.accessToken;
    } catch (e) {
      if (kDebugMode) {
        developer.log('[ApiClient] Token refresh failed: $e', name: 'ApiClient');
      }
      return null;
    }
  }

  // ── Core request execution ────────────────────────────────────────

  Future<http.Response> _execute(
    Future<http.Response> Function(Map<String, String> headers) fn, {
    Map<String, String>? additionalHeaders,
    bool isRetry = false,
  }) async {
    // Ensure we have a fresh Firebase token before making the request.
    if (!isRetry) {
      await _accessTokenAsync;
    }
    final response = await fn(_headers(additionalHeaders: additionalHeaders)).timeout(_timeout);

    if (response.statusCode == 401 && !isRetry) {
      if (kDebugMode) {
        developer.log(
          '[ApiClient] 401 received — attempting token refresh',
          name: 'ApiClient',
        );
      }

      final newToken = await _refreshedToken();
      if (newToken == null) {
        throw const ApiAuthException(
          'Session expired and token refresh failed. Please log in again.',
        );
      }

      final retryResponse = await fn(_headers(token: newToken, additionalHeaders: additionalHeaders)).timeout(_timeout);
      if (retryResponse.statusCode == 401) {
        throw const ApiAuthException(
          'Authentication failed after token refresh. Please log in again.',
        );
      }
      return retryResponse;
    }

    return response;
  }

  // ── URI building and path normalization ───────────────────────────

  Uri _buildUri(String path) {
    final baseUri = Uri.parse(_baseUrl);
    final cleanPath = path.startsWith('/') ? path.substring(1) : path;
    final queryStart = cleanPath.indexOf('?');
    final rawPath = queryStart == -1
        ? cleanPath
        : cleanPath.substring(0, queryStart);
    final rawQuery =
        queryStart == -1 ? null : cleanPath.substring(queryStart + 1);
    final baseSegments =
        baseUri.pathSegments.where((segment) => segment.isNotEmpty);
    final requestSegments =
        rawPath.split('/').where((segment) => segment.isNotEmpty);

    return baseUri.replace(
      pathSegments: <String>[...baseSegments, ...requestSegments],
      query: rawQuery?.isEmpty == true ? null : rawQuery,
    );
  }

  // ── HTTP methods ──────────────────────────────────────────────────

  Future<dynamic> get(String path, {Map<String, String>? headers}) async {
    final uri = _buildUri(path);
    final response = await _execute(
      (h) => _http.get(uri, headers: h),
      additionalHeaders: headers,
    );
    return _decode(response);
  }

  /// Performs a GET request and returns the raw response body as [String].
  ///
  /// Useful for downloading non-JSON payloads such as CSV files.
  Future<String> getRaw(String path, {Map<String, String>? headers}) async {
    final uri = _buildUri(path);
    final response = await _execute(
      (h) => _http.get(uri, headers: h),
      additionalHeaders: headers,
    );
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response.body;
    }
    throw ApiException(
      response.statusCode,
      'Failed to fetch raw response',
      body: response.body,
    );
  }

  Future<dynamic> post(String path, {Object? body, Map<String, String>? headers}) async {
    final uri = _buildUri(path);
    final encoded = body != null ? jsonEncode(body) : null;
    final response = await _execute(
      (h) => _http.post(uri, headers: h, body: encoded),
      additionalHeaders: headers,
    );
    return _decode(response);
  }

  Future<dynamic> put(String path, {Object? body, Map<String, String>? headers}) async {
    final uri = _buildUri(path);
    final encoded = body != null ? jsonEncode(body) : null;
    final response = await _execute(
      (h) => _http.put(uri, headers: h, body: encoded),
      additionalHeaders: headers,
    );
    return _decode(response);
  }

  Future<dynamic> patch(String path, {Object? body, Map<String, String>? headers}) async {
    final uri = _buildUri(path);
    final encoded = body != null ? jsonEncode(body) : null;
    final response = await _execute(
      (h) => _http.patch(uri, headers: h, body: encoded),
      additionalHeaders: headers,
    );
    return _decode(response);
  }

  Future<dynamic> delete(String path, {Map<String, String>? headers}) async {
    final uri = _buildUri(path);
    final response = await _execute(
      (h) => _http.delete(uri, headers: h),
      additionalHeaders: headers,
    );
    return _decode(response);
  }

  void dispose() {
    if (_isClientOwned) {
      _http.close();
    }
  }

  // ── Response decoding ─────────────────────────────────────────────

  dynamic _decode(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (response.body.isEmpty) return null;
      try {
        return jsonDecode(response.body);
      } catch (_) {
        throw ApiException(
          response.statusCode,
          'Invalid JSON response',
          body: response.body,
        );
      }
    }

    if (kDebugMode) {
      developer.log(
        '[ApiClient] Request failed: ${response.statusCode} ${response.body}',
        name: 'ApiClient',
      );
    }

    String message;
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) {
        message = (decoded['error'] ?? decoded['message'] ?? response.reasonPhrase ?? 'Unknown error').toString();
      } else {
        message = response.reasonPhrase ?? 'Unknown error';
      }
    } catch (_) {
      message = response.reasonPhrase ?? 'Unknown error';
    }

    throw ApiException(response.statusCode, message, body: response.body);
  }
}
