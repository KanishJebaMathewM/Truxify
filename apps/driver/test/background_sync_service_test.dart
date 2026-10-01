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
