import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:truxify_driver/screens/pod_capture_screen.dart';
import 'package:truxify_driver/services/background_sync_service.dart';
import 'package:truxify_driver/services/pod_storage_service.dart';

class _Storage extends PodStorageService {
  final saved = <PodRecord>[];
  @override
  Future<int> insertPod(PodRecord pod) async {
    saved.add(pod);
    return saved.length;
  }

  @override
  Future<PodSyncMetrics> metrics() async => const PodSyncMetrics(1, 0, 0, null);
}

class _Paths extends PathProviderPlatform {
  final String path;
  _Paths(this.path);
  @override
  Future<String?> getApplicationDocumentsPath() async => path;
}

class _Picker extends ImagePickerPlatform {
  final String path;
  _Picker(this.path);
  @override
  Future<XFile?> getImageFromSource({
    required ImageSource source,
    ImagePickerOptions options = const ImagePickerOptions(),
  }) async => XFile(path);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final originalPaths = PathProviderPlatform.instance;
  final originalPicker = ImagePickerPlatform.instance;
  late Directory dir;
  late _Storage storage;
  late Completer<void> batch;
  var syncCalls = 0;
  setUp(() async {
    dir = await Directory.systemTemp.createTemp('pod-capture-queue');
    PathProviderPlatform.instance = _Paths(dir.path);
    final photo = await File('${dir.path}/camera.gif').writeAsBytes(
      base64Decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
    );
    ImagePickerPlatform.instance = _Picker(photo.path);
    storage = _Storage();
    podStorageService = storage;
    batch = Completer<void>();
    syncCalls = 0;
    BackgroundSyncService.syncOverride = () {
      syncCalls++;
      return batch.future;
    };
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('dev.fluttercommunity.plus/connectivity'),
          (_) async => ['wifi'],
        );
  });
  tearDown(() async {
    if (!batch.isCompleted) batch.complete();
    await Future<void>.delayed(Duration.zero);
    BackgroundSyncService.syncOverride = null;
    podStorageService = PodStorageService();
    PathProviderPlatform.instance = originalPaths;
    ImagePickerPlatform.instance = originalPicker;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('dev.fluttercommunity.plus/connectivity'),
          null,
        );
    await dir.delete(recursive: true);
  });

  for (final existing in [false, true]) {
    testWidgets(
      'saved capture returns while ${existing ? "existing" : "new"} sync is stalled',
      (tester) async {
        if (existing) unawaited(BackgroundSyncService.syncPods());
        await tester.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) =>
                          const PodCaptureScreen(orderId: 'captured'),
                    ),
                  ),
                  child: const Text('Open capture'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open capture'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Take Photo'));
        await tester.runAsync(() async {
          await tester.tap(find.text('Take Photo'));
          await Future<void>.delayed(const Duration(milliseconds: 50));
        });
        await tester.pump();
        await tester.runAsync(() async {
          await Future<void>.delayed(const Duration(milliseconds: 100));
        });
        await tester.pump();
        await tester.ensureVisible(find.text('Save Proof of Delivery'));
        await tester.runAsync(() async {
          await tester.tap(find.text('Save Proof of Delivery'));
          // The actual file copy uses the real event loop; the background
          // batch remains deliberately incomplete.
          for (var i = 0; i < 100 && storage.saved.isEmpty; i++) {
            await Future<void>.delayed(const Duration(milliseconds: 10));
          }
          await Future<void>.delayed(const Duration(milliseconds: 20));
        });
        for (var i = 0; i < 10; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(storage.saved, hasLength(1));
        expect(File(storage.saved.single.photoPath!).existsSync(), isTrue);
        expect(find.byType(PodCaptureScreen), findsNothing);
        expect(find.text('Open capture'), findsOneWidget);
        expect(
          find.text('Proof of Delivery saved. Uploading in background.'),
          findsOneWidget,
        );
        expect(
          find.text('Proof of Delivery uploaded successfully'),
          findsNothing,
        );
        expect(syncCalls, 1);
        expect(batch.isCompleted, isFalse);
      },
    );
  }
}
