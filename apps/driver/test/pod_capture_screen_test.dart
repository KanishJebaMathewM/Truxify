import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:signature/signature.dart';
import 'package:truxify_driver/screens/pod_capture_screen.dart';
import 'package:truxify_driver/services/pod_storage_service.dart';
import 'setup.dart';

/// Fake storage that mimics the real DB contract: `insertPod` returns the
/// auto-increment id but never mutates the record, so the caller must pass the
/// returned id to `markAsSynced`.
class FakePodStorageService extends PodStorageService {
  final markedSyncedIds = <int>[];
  int getUnsyncedPodsCallCount = 0;

  @override
  Future<int> insertPod(PodRecord pod) async => 42;

  @override
  Future<int> markAsSynced(int id) async {
    markedSyncedIds.add(id);
    return 1;
  }

  @override
  Future<List<PodRecord>> getUnsyncedPods() async {
    getUnsyncedPodsCallCount++;
    return [];
  }
}

/// Stubs all HTTP traffic so an immediate upload can succeed without a server.
class _FakeHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) => _FakeHttpClient();
}

class _FakeHttpClient implements HttpClient {
  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async =>
      _FakeHttpClientRequest();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeHttpClientRequest implements HttpClientRequest {
  @override
  HttpHeaders get headers => _FakeHttpHeaders();

  @override
  int get contentLength => 0;
  @override
  set contentLength(int value) {}

  @override
  bool get followRedirects => false;
  @override
  set followRedirects(bool value) {}
  @override
  int get maxRedirects => 0;
  @override
  set maxRedirects(int value) {}
  @override
  bool get persistentConnection => false;
  @override
  set persistentConnection(bool value) {}

  @override
  Future<HttpClientResponse> close() async => _FakeHttpClientResponse();

  @override
  void add(List<int> data) {}

  @override
  Future<void> addStream(Stream<List<int>> stream) async {
    await for (final _ in stream) {}
  }

  @override
  Future<void> flush() async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeHttpHeaders implements HttpHeaders {
  final Map<String, List<String>> _values = {};

  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) {
    _values[name] = [value.toString()];
  }

  @override
  void add(String name, Object value, {bool preserveHeaderCase = false}) {
    _values.putIfAbsent(name, () => []).add(value.toString());
  }

  @override
  Map<String, List<String>> map([bool Function(String, List<String>)? predicate]) {
    final result = <String, List<String>>{};
    _values.forEach((key, value) {
      if (predicate == null || predicate(key, value)) {
        result[key] = value;
      }
    });
    return result;
  }

  @override
  String? value(String name) => _values[name]?.join(',');

  @override
  List<String>? operator [](String name) => _values[name];

  @override
  void forEach(void Function(String, List<String>) action) =>
      _values.forEach(action);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeHttpClientResponse extends StreamView<List<int>>
    implements HttpClientResponse {
  _FakeHttpClientResponse() : super(Stream.value(utf8.encode('{}')));

  @override
  int get statusCode => 200;
  @override
  String get reasonPhrase => 'OK';
  @override
  int get contentLength => 2;
  @override
  HttpHeaders get headers => _FakeHttpHeaders();
  @override
  bool get isRedirect => false;
  @override
  bool get persistentConnection => false;
  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late FakePodStorageService fakeStorage;
  late Directory tempDir;

  setUpAll(() async {
    // Initializes Firebase + Supabase so ApiClient's token lookups do not throw.
    await setupTests();
  });

  setUp(() async {
    fakeStorage = FakePodStorageService();
    podStorageService = fakeStorage;
    HttpOverrides.global = _FakeHttpOverrides();
    tempDir = await Directory.systemTemp.createTemp('pod_capture_test_');

    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (call) async {
        if (call.method == 'getApplicationDocumentsPath') return tempDir.path;
        return null;
      },
    );
    messenger.setMockMethodCallHandler(
      const MethodChannel('dev.fluttercommunity.plus/connectivity'),
      (call) async {
        if (call.method == 'check') return ['wifi'];
        return null;
      },
    );
  });

  tearDown(() async {
    podStorageService = PodStorageService();
    HttpOverrides.global = null;
    await tempDir.delete(recursive: true);

    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
        const MethodChannel('plugins.flutter.io/path_provider'), null);
    messenger.setMockMethodCallHandler(
        const MethodChannel('dev.fluttercommunity.plus/connectivity'), null);
  });

  testWidgets(
      'online PoD capture marks the inserted row synced and does not re-upload',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: PodCaptureScreen(orderId: 'order-1')),
    );

    // Draw a signature so the save flow is not short-circuited. Drag mostly
    // horizontally so the scroll view's vertical drag recognizer does not
    // claim the gesture instead of the Signature widget.
    await tester.drag(find.byType(Signature), const Offset(120, 0));
    await tester.pump();
    await tester.ensureVisible(find.text('Save Proof of Delivery'));

    await tester.runAsync(() async {
      await tester.tap(find.text('Save Proof of Delivery'));
      // Do NOT pump here: pumping would rebuild the body to the progress
      // spinner and dispose the Signature widget while toPngBytes() is still
      // running. Let the real async work (signature render, file write,
      // upload, markAsSynced) complete first.
      await Future<void>.delayed(const Duration(milliseconds: 1000));
    });

    await tester.pumpAndSettle();

    // The success path is taken: the row is marked synced with the id returned
    // by insertPod (42), the success confirmation is shown, and the background
    // re-upload (which would call getUnsyncedPods) is never triggered.
    expect(fakeStorage.markedSyncedIds, [42]);
    expect(fakeStorage.getUnsyncedPodsCallCount, 0);
    expect(find.text('Proof of Delivery uploaded successfully'), findsOneWidget);
    expect(find.text('Upload pending, will retry in background.'), findsNothing);
  });
}
