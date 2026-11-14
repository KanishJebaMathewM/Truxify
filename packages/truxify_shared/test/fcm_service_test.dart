
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_shared/truxify_shared.dart';

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
    lastPutBody = body is Map<String, dynamic>
        ? Map<String, dynamic>.from(body)
        : null;
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
    lastPostBody = body is Map<String, dynamic>
        ? Map<String, dynamic>.from(body)
        : null;
    return null;
  }
}

bool _supabaseAvailable() {
  try {
    Supabase.instance.client;
    return true;
  } catch (_) {
    return false;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('FcmService FCM token registration (issue #11489)', () {
    test(
      'registers FCM token for an authenticated Supabase user',
      () async {
        if (!_supabaseAvailable()) {
          markTestSkipped('Supabase is not initialized.');
          return;
        }

        final user = Supabase.instance.client.auth.currentUser;

        if (user == null) {
          markTestSkipped('A signed-in Supabase user is required.');
          return;
        }

        final fake = FakeApiClient();

        await FcmService.clearToken(apiClient: fake);

        expect(fake.lastPutPath, '/api/profile/fcm-token');
        expect(fake.lastPutBody, isNotNull);
        expect(fake.lastPutBody!['fcmToken'], isNull);
        expect(fake.lastPutBody!['userId'], user.id);
      },
    );

    test(
      'does not register token when no Supabase user is authenticated',
      () async {
        if (!_supabaseAvailable()) {
          markTestSkipped('Supabase is not initialized.');
          return;
        }

        final user = Supabase.instance.client.auth.currentUser;

        if (user != null) {
          markTestSkipped(
            'This test requires a signed-out Supabase session.',
          );
          return;
        }

        final fake = FakeApiClient();

        await FcmService.clearToken(apiClient: fake);

        expect(fake.lastPutPath, isNull);
        expect(fake.lastPutBody, isNull);
      },
    );
  });
}
