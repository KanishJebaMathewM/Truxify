import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:truxify_driver/services/pod_storage_service.dart';
import 'package:truxify_driver/services/pod_sync_runner.dart';
import 'package:truxify_driver/services/pod_upload_transport.dart';

void main() {
  sqfliteFfiInit();
  late Database db;
  late PodStorageService storage;
  var clock = 1000000;
  Future<int> add(String name) => storage.insertPod(
    PodRecord(orderId: name, photoPath: '/proof.jpg', createdAt: clock),
  );
  setUp(() async {
    clock = 1000000;
    db = await databaseFactoryFfi.openDatabase(
      inMemoryDatabasePath,
      options: OpenDatabaseOptions(
        version: 3,
        onCreate: PodStorageService.createDatabase,
      ),
    );
    storage = PodStorageService(database: db);
  });
  tearDown(() => db.close());

  for (final old in [1, 2]) {
    test('upgrades v$old without losing offline PODs', () async {
      final dir = await Directory.systemTemp.createTemp('pod-migration');
      final path = '${dir.path}/pods.db';
      var legacy = await databaseFactoryFfi.openDatabase(
        path,
        options: OpenDatabaseOptions(
          version: old,
          onCreate: (db, version) =>
              PodStorageService.createDatabase(db, version),
        ),
      );
      await legacy.insert('pods', {
        'order_id': 'saved',
        'photo_path': '/photo',
        'created_at': 42,
      });
      await legacy.close();
      legacy = await databaseFactoryFfi.openDatabase(
        path,
        options: OpenDatabaseOptions(
          version: 3,
          onUpgrade: PodStorageService.upgradeDatabase,
        ),
      );
      final migrated = PodStorageService(database: legacy);
      final pod = (await migrated.getUnsyncedPods()).single;
      expect(pod.orderId, 'saved');
      expect(pod.photoPath, '/photo');
      expect(pod.uploadKey, isNotEmpty);
      expect(
        (await legacy.rawQuery('PRAGMA index_list(pods)'))
            .map((r) => r['name']),
        containsAll([
          'idx_pods_synced',
          'idx_pods_order_id',
          'idx_pods_created_at',
          'idx_pods_due',
        ]),
      );
      await legacy.close();
      await dir.delete(recursive: true);
    });
  }

  test(
    'independent connections preserve ownership and due time across restart',
    () async {
      final dir = await Directory.systemTemp.createTemp('pod-connections');
      final path = '${dir.path}/pods.db';
      final options = OpenDatabaseOptions(
        version: 3,
        singleInstance: false,
        onCreate: PodStorageService.createDatabase,
      );
      var one = await databaseFactoryFfi.openDatabase(path, options: options);
      final two = await databaseFactoryFfi.openDatabase(path, options: options);
      final a = PodStorageService(database: one),
          b = PodStorageService(database: two);
      final id = await a.insertPod(
        PodRecord(orderId: 'shared', createdAt: clock),
      );
      final claims = await Future.wait([a.claimDue(clock), b.claimDue(clock)]);
      expect(claims.whereType<PodRecord>(), hasLength(1));
      final claimed = claims.whereType<PodRecord>().single;
      await a.fail(claimed, clock, 'HTTP 503');
      await one.close();
      one = await databaseFactoryFfi.openDatabase(path, options: options);
      final reopened = PodStorageService(database: one);
      expect((await reopened.getPod(id))!.lastError, 'HTTP 503');
      expect(await reopened.claimDue(clock + 59999), isNull);
      expect(
        (await reopened.claimDue(clock + 60000))!.uploadKey,
        claimed.uploadKey,
      );
      await one.close();
      await two.close();
      await dir.delete(recursive: true);
    },
  );

  test(
    'concurrent admissions share one lease and fence stale completion',
    () async {
      final id = await add('a');
      final claims = await Future.wait([
        storage.claimDue(clock),
        PodStorageService(database: db).claimDue(clock),
      ]);
      expect(claims.whereType<PodRecord>(), hasLength(1));
      final first = claims.whereType<PodRecord>().single;
      expect(await storage.markAsSynced(id), 0);
      clock += PodStorageService.lease.inMilliseconds;
      expect(await storage.complete(first, clock), false);
      final second = (await storage.claimDue(clock))!;
      expect(second.generation, first.generation + 1);
      expect(second.uploadKey, first.uploadKey);
      expect(await storage.fail(first, clock, 'stale'), false);
      expect(await storage.complete(second, clock), true);
      expect((await storage.metrics()).lastSuccess, clock);
    },
  );

  test('persists exact delays, prioritizes new jobs, dead letters attempt ten and requeues', () async {
    final id = await add('retry');
    final key = (await storage.getPod(id))!.uploadKey;
    for (var attempt = 1; attempt <= 10; attempt++) {
      final pod = (await storage.claimDue(clock))!;
      expect(pod.retryCount, attempt);
      await storage.fail(pod, clock, 'HTTP 503');
      if (attempt < 10) {
        final due =
            clock +
            PodStorageService
                .retryDelays[(attempt - 1).clamp(0, 5)]
                .inMilliseconds;
        expect((await storage.getPod(id))!.nextAttemptAt, due);
        expect(await storage.claimDue(due - 1), isNull);
        clock = due;
        if (attempt == 1) {
          await add('fresh');
          final fresh = (await storage.claimDue(clock))!;
          expect(fresh.orderId, 'fresh');
          await storage.complete(fresh, clock);
        }
      }
    }
    expect((await storage.metrics()).deadLetterCount, 1);
    expect(await storage.claimDue(clock + 999999999), isNull);
    expect((await storage.deadLetters()).single['last_error'], 'HTTP 503');
    expect(await storage.requeue(id), true);
    expect(await storage.requeue(id), false);
    expect(await storage.deadLetters(), isEmpty);
    final recovered = (await storage.claimDue(clock))!;
    expect(recovered.retryCount, 1);
    expect(recovered.uploadKey, key);
  });

  test(
    'expired tenth lease moves to dead letters after worker crash',
    () async {
      final id = await add('crashed');
      await db.update(
        'pods',
        {'retry_count': 9},
        where: 'id = ?',
        whereArgs: [id],
      );
      await storage.claimDue(clock);
      clock += PodStorageService.lease.inMilliseconds;
      expect(await storage.claimDue(clock), isNull);
      expect((await storage.deadLetters()).single['attempts'], 10);
    },
  );

  test('credentials unavailable do not admit or burn attempts', () async {
    final id = await add('auth');
    await PodSyncRunner(
      storage: storage,
      token: (_) async => null,
      upload: (pod, credential) async => throw StateError('must not upload'),
      now: () => clock,
    ).run();
    expect((await storage.getPod(id))!.retryCount, 0);
  });

  test('401 refresh retries same identity, repeated auth failure pauses without burn', () async {
    final id = await add('auth');
    var calls = 0;
    final keys = <String?>[];
    await PodSyncRunner(
      storage: storage,
      token: (refresh) async => refresh ? 'new' : 'old',
      upload: (pod, token) async {
        calls++;
        keys.add(pod.uploadKey);
        return 401;
      },
      now: () => clock,
    ).run();
    expect(calls, 2);
    expect(keys.toSet(), hasLength(1));
    expect((await storage.getPod(id))!.retryCount, 0);
    expect((await storage.metrics()).deadLetterCount, 0);
  });

  test('bounded batch isolates document failures and persists sanitized diagnostics', () async {
    await add('bad');
    await add('good');
    await add('later');
    await PodSyncRunner(
      storage: storage,
      token: (_) async => 'token',
      upload: (pod, _) async {
        if (pod.orderId == 'bad') throw StateError('secret');
        return 201;
      },
      now: () => clock,
    ).run(batchSize: 2);
    final stats = await storage.metrics();
    expect(stats.pendingCount, 1);
    expect(stats.retryingCount, 1);
    expect(
      (await storage.getUnsyncedPods()).last.lastError,
      'Upload failed (StateError)',
    );
  });

  test('native stalled HTTP response is aborted within total upload timeout', () async {
    final file = await File(
      '${Directory.systemTemp.path}/pod-${DateTime.now().microsecondsSinceEpoch}.jpg',
    ).writeAsBytes([1, 2]);
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    String? key;
    server.listen((request) async {
      key = request.headers.value('x-idempotency-key');
      await request.drain<void>();
    });
    final transport = PodUploadTransport(
      Uri.parse('http://127.0.0.1:${server.port}'),
      timeout: const Duration(milliseconds: 100),
    );
    await expectLater(
      transport.upload(
        PodRecord(
          id: 1,
          orderId: 'order',
          photoPath: file.path,
          createdAt: 1,
          uploadKey: 'stable',
        ),
        'token',
      ),
      throwsA(isA<TimeoutException>()),
    );
    expect(key, 'stable');
    await server.close(force: true);
    await file.delete();
  });

  test(
    'missing attachment fails before HTTP instead of posting partial proof',
    () async {
      var sends = 0;
      final transport = PodUploadTransport(
        Uri.parse('https://example.invalid'),
        clientFactory: () => _Client(() {
          sends++;
        }),
      );
      await expectLater(
        transport.upload(
          PodRecord(
            id: 1,
            orderId: 'order',
            photoPath: '/absent-pod.jpg',
            createdAt: 1,
            uploadKey: 'stable',
          ),
          'token',
        ),
        throwsA(isA<FileSystemException>()),
      );
      expect(sends, 0);
    },
  );
}

class _Client extends http.BaseClient {
  final void Function() sent;
  _Client(this.sent);
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    sent();
    return http.StreamedResponse(const Stream.empty(), 200);
  }
}
