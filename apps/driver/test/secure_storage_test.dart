import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/secure_storage.dart';

void main() {
  group('SecureStorage', () {
    setUp(() async {
      FlutterSecureStorage.setMockInitialValues({});
      await AuthTokenStore.clear();
    });

    test('round-trips a value through save/read/delete', () async {
      await SecureStorage.save('driver_id', 'd42');
      expect(await SecureStorage.read('driver_id'), 'd42');

      await SecureStorage.delete('driver_id');
      expect(await SecureStorage.read('driver_id'), isNull);
    });

    test('persist writes the token under the well-known key', () async {
      await AuthTokenStore.persist('token-abc');

      expect(await AuthTokenStore.read(), 'token-abc');
      expect(await SecureStorage.read(SecureStorageKeys.authToken), 'token-abc');
    });

    test('persist ignores null and empty tokens', () async {
      await AuthTokenStore.persist(null);
      await AuthTokenStore.persist('');

      expect(await AuthTokenStore.read(), isNull);
    });

    test('persist overwrites when the token changes', () async {
      await AuthTokenStore.persist('first');
      await AuthTokenStore.persist('first');
      await AuthTokenStore.persist('second');

      expect(await AuthTokenStore.read(), 'second');
    });

    test('clear removes the token and resets the dedup cache', () async {
      await AuthTokenStore.persist('token-x');
      await AuthTokenStore.clear();

      expect(await AuthTokenStore.read(), isNull);

      await AuthTokenStore.persist('token-y');
      expect(await AuthTokenStore.read(), 'token-y');
    });
  });
}
