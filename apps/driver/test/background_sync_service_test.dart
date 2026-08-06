import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/background_sync_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    BackgroundSyncService.scheduleTaskOverride = null;
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
}
