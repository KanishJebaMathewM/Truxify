import 'package:flutter_test/flutter_test.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:truxify_driver/services/background_sync_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    BackgroundSyncService.scheduleTaskOverride = null;
    BackgroundSyncService.syncOverride = null;
    BackgroundSyncService.connectivityChanged([ConnectivityResult.none]);
  });

  test('upload URL policy requires HTTPS outside debug loopback', () {
    for (final host in ['localhost', '127.0.0.1', '[::1]']) {
      expect(
        BackgroundSyncService.uploadBaseUri('http://$host:5000', debug: true),
        isNotNull,
      );
      expect(
        BackgroundSyncService.uploadBaseUri('http://$host:5000', debug: false),
        isNull,
      );
    }
    for (final value in [
      '',
      '/api',
      'ftp://api.example',
      'http://api.example',
      'http://localhost.example',
      'https://user:secret@api.example',
    ]) {
      expect(BackgroundSyncService.uploadBaseUri(value, debug: true), isNull);
      expect(BackgroundSyncService.uploadBaseUri(value, debug: false), isNull);
    }
    expect(
      BackgroundSyncService.uploadBaseUri(
        'https://api.example/base',
        debug: false,
      )?.path,
      '/base',
    );
  });

  test('registerSyncTask schedules the background sync task exactly once (issue #6281)', () {
    var scheduleCalls = 0;
    BackgroundSyncService.scheduleTaskOverride = () => scheduleCalls++;

    BackgroundSyncService.registerSyncTask();
    BackgroundSyncService.registerSyncTask();
    BackgroundSyncService.registerSyncTask();

    // Guard against duplicate scheduling: only the first call registers.
    expect(scheduleCalls, 1);
  });
  testWidgets('connectivity bursts debounce and going offline cancels sync', (
    tester,
  ) async {
    var calls = 0;
    BackgroundSyncService.syncOverride = () async {
      calls++;
    };
    BackgroundSyncService.connectivityChanged([ConnectivityResult.wifi]);
    await tester.pump(const Duration(seconds: 20));
    BackgroundSyncService.connectivityChanged([ConnectivityResult.mobile]);
    await tester.pump(const Duration(seconds: 29));
    expect(calls, 0);
    await tester.pump(const Duration(seconds: 1));
    expect(calls, 1);
    BackgroundSyncService.connectivityChanged([ConnectivityResult.wifi]);
    BackgroundSyncService.connectivityChanged([ConnectivityResult.none]);
    await tester.pump(const Duration(seconds: 31));
    expect(calls, 1);
  });
}
