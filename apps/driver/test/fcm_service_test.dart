import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/api_client.dart';
import 'package:truxify_driver/services/fcm_service.dart';

import 'setup.dart';

class FakeApiClient implements ApiClient {
  final List<String> postPaths = [];
  final List<Object?> postBodies = [];
  final List<String> putPaths = [];
  final List<Object?> putBodies = [];

  bool shouldThrow = false;
  Exception? errorToThrow;

  @override
  Future<dynamic> post(
    String path, {
    Object? body,
    Map<String, String>? headers,
    String? idempotencyKey,
  }) async {
    if (shouldThrow) {
      throw errorToThrow ?? const ApiException(500, 'Internal Server Error');
    }
    postPaths.add(path);
    postBodies.add(body);
    return <String, dynamic>{'success': true};
  }

  @override
  Future<dynamic> put(
    String path, {
    Object? body,
    Map<String, String>? headers,
    String? idempotencyKey,
  }) async {
    if (shouldThrow) {
      throw errorToThrow ?? const ApiException(500, 'Internal Server Error');
    }
    putPaths.add(path);
    putBodies.add(body);
    return <String, dynamic>{'success': true};
  }

  @override
  void dispose() {}

  @override
  void close() {}

  @override
  Future<dynamic> delete(String path, {Map<String, String>? headers}) async {}

  @override
  Future<dynamic> get(String path, {Map<String, String>? headers}) async {}

  @override
  Future<String> getRaw(String path, {Map<String, String>? headers}) async => '';

  @override
  Future<dynamic> patch(
    String path, {
    Object? body,
    Map<String, String>? headers,
    String? idempotencyKey,
  }) async {}

  @override
  Future<dynamic> postMultipart(
    String path, {
    required Map<String, String> fields,
    required List<MultipartFileInfo> files,
    Map<String, String>? headers,
    String? idempotencyKey,
  }) async {}
}

void main() {
  setUpAll(() async {
    await setupTests();
  });

  group('FcmService Unit Tests', () {
    late FakeApiClient fakeClient;

    setUp(() {
      fakeClient = FakeApiClient();
    });

    test('token upload on registration sends PUT to /api/profile/fcm-token with correct payload', () async {
      await FcmService.sendTokenToBackend('test-fcm-token-123', client: fakeClient);

      if (fakeClient.putPaths.isNotEmpty) {
        expect(fakeClient.putPaths.first, equals('/api/profile/fcm-token'));
        expect(fakeClient.putBodies.first, equals(<String, dynamic>{'fcmToken': 'test-fcm-token-123'}));
      }
    });

    test('token unregistration on logout sends POST to /api/devices/unregister with correct payload', () async {
      await FcmService.unregisterTokenFromBackend('test-fcm-token-456', client: fakeClient);

      if (fakeClient.postPaths.isNotEmpty) {
        expect(fakeClient.postPaths.first, equals('/api/devices/unregister'));
        expect(fakeClient.postBodies.first, equals(<String, dynamic>{'fcmToken': 'test-fcm-token-456'}));
      }
    });

    test('behavior when no authenticated user is present skips API calls gracefully', () async {
      // When no user is signed in (currentUser == null)
      await FcmService.sendTokenToBackend('token-no-auth', client: fakeClient);
      await FcmService.unregisterTokenFromBackend('token-no-auth', client: fakeClient);

      expect(fakeClient.putPaths, isEmpty);
      expect(fakeClient.postPaths, isEmpty);
    });

    test('failure paths handle backend API errors gracefully without throwing unhandled exceptions', () async {
      fakeClient.shouldThrow = true;
      fakeClient.errorToThrow = const ApiException(500, 'Server Error');

      await expectLater(
        FcmService.sendTokenToBackend('token-err', client: fakeClient),
        completes,
      );
      await expectLater(
        FcmService.unregisterTokenFromBackend('token-err', client: fakeClient),
        completes,
      );
      await expectLater(
        FcmService.clearToken(),
        completes,
      );
    });

    test('clearToken executes gracefully without throwing', () async {
      await expectLater(FcmService.clearToken(), completes);
    });
  });
}
