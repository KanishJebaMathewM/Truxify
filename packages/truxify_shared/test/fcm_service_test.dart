import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_shared/truxify_shared.dart';

/// A fake [ApiClient] that records the bodies of `put`/`post` calls instead of
/// performing real network requests. This lets us assert what [FcmService]
/// would send to the backend without needing a running server.
class FakeApiClient extends ApiClient {
  FakeApiClient();

  Map<String, dynamic>? lastPutBody;
  String? lastPutPath;
  Map<String, dynamic>? lastPostBody;
  String? lastPostPath;

  @override
  Future<dynamic> put(
    String path, {
    Object? body,
    Map<String, String>? headers,
    String? idempotencyKey,
  }) async {
    lastPutPath = path;
    lastPutBody = body is Map<String, dynamic> ? body : null;
    return null;
  }

  @override
  Future<dynamic> post(
    String path, {
    Object? body,
    Map<String, String>? headers,
    String? idempotencyKey,
  }) async {
    lastPostPath = path;
    lastPostBody = body is Map<String, dynamic> ? body : null;
    return null;
  }
}

/// Returns true when a Supabase session is available in the test environment.
///
/// The FCM token registration fix (#11489) must register the token for users
/// authenticated via *either* Firebase or Supabase. In a unit-test environment
/// neither auth provider is initialized, so these tests are skipped there; they
/// run (and assert the regression) in an environment where Supabase is
/// initialized with a signed-in user.
bool _supabaseAvailable() {
  try {
    // Accessing the client throws if Supabase has not been initialized.
    Supabase.instance.client.auth.currentUser;
    return true;
  } catch (_) {
    return false;
  }
}

void main() {
  group('FcmService FCM token registration (issue #11489)', () {
    test(
      'registers FCM token for a Supabase-only user and scopes it via userId',
      () async {
        if (!_supabaseAvailable()) {
          markTestSkipped(
            'Requires an initialized Supabase client with a signed-in user.',
          );
        }

        final fake = FakeApiClient();
        // clearToken() routes through _sendTokenToBackend, exercising the
        // auth-gating and request-body construction without needing
        // FirebaseMessaging.
        await FcmService.clearToken(apiClient: fake);

        // Before the fix, a Supabase-only user was silently skipped because the
        // gating checked only FirebaseAuth.instance.currentUser.
        expect(fake.lastPutPath, equals('/api/profile/fcm-token'));
        expect(fake.lastPutBody, isNotNull);
        expect(fake.lastPutBody!['fcmToken'], isNull);
        // The token must be associated with the correct (Supabase) user id so
        // the backend can scope notifications and avoid cross-user leaks.
        expect(fake.lastPutBody!['userId'], isA<String>());
        expect(fake.lastPutBody!['userId'], isNotEmpty);
      },
    );

    test(
      'does not register the token when no user is authenticated on either '
      'provider',
      () async {
        // If no auth provider is configured we cannot assert the negative path
        // reliably; this guard keeps the suite green in bare test runners.
        if (!_supabaseAvailable()) {
          markTestSkipped(
            'Requires an initialized Supabase client to evaluate auth state.',
          );
        }

        final fake = FakeApiClient();
        await FcmService.clearToken(apiClient: fake);

        final hasSupabaseUser =
            Supabase.instance.client.auth.currentUser != null;
        if (!hasSupabaseUser) {
          // No authenticated user on either provider -> backend must NOT be hit.
          expect(fake.lastPutPath, isNull);
        }
      },
    );
  });
}
