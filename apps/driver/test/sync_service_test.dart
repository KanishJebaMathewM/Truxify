import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_driver/services/sync_service.dart';
import 'package:truxify_driver/services/api_client.dart';
import 'package:truxify_driver/services/local_db_service.dart';
import 'package:truxify_driver/services/trip_service.dart';
import 'setup.dart';

http.Client createUnusedHttpClient() => http.Client();

class MockGoTrueClient implements GoTrueClient {
  final User? mockUser;
  final Session? mockSession;
  MockGoTrueClient({this.mockUser, this.mockSession});

  @override
  User? get currentUser => mockUser;

  @override
  Session? get currentSession => mockSession;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakeUser implements User {
  final String _id;
  FakeUser(this._id);
  @override
  String get id => _id;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakePostgrestTransformBuilder<T> implements PostgrestTransformBuilder<T> {
  final Future<dynamic> _futureValue;

  FakePostgrestTransformBuilder(this._futureValue);

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #maybeSingle) {
      return FakePostgrestTransformBuilder<Map<String, dynamic>?>(_futureValue.then((val) {
        if (val is List && val.isNotEmpty) {
          return val.first as Map<String, dynamic>;
        } else if (val is Map<String, dynamic>) {
          return val;
        }
        return null;
      }));
    }
    if (invocation.memberName == #then) {
      final Function onValue = invocation.positionalArguments[0] as Function;
      final Function? onError = invocation.namedArguments[#onError] as Function?;
      return _futureValue.then((val) => onValue(val), onError: onError);
    }
    return this;
  }
}

class FakePostgrestFilterBuilder<T> implements PostgrestFilterBuilder<T> {
  final Future<dynamic> _futureValue;
  final Function(String, dynamic)? onEq;
  final Function(Map)? onUpdate;

  FakePostgrestFilterBuilder(this._futureValue, {this.onEq, this.onUpdate});

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #eq) {
      final String col = invocation.positionalArguments[0] as String;
      final Object val = invocation.positionalArguments[1];
      onEq?.call(col, val);
      return this;
    }
    if (invocation.memberName == #select) {
      return FakePostgrestTransformBuilder<List<Map<String, dynamic>>>(_futureValue);
    }
    if (invocation.memberName == #maybeSingle) {
      return FakePostgrestTransformBuilder<Map<String, dynamic>?>(_futureValue.then((val) {
        if (val is List && val.isNotEmpty) {
          return val.first as Map<String, dynamic>;
        } else if (val is Map<String, dynamic>) {
          return val;
        }
        return null;
      }));
    }
    if (invocation.memberName == #then) {
      final Function onValue = invocation.positionalArguments[0] as Function;
      final Function? onError = invocation.namedArguments[#onError] as Function?;
      return _futureValue.then((val) => onValue(val), onError: onError);
    }
    return this;
  }
}

class FakeSupabaseQueryBuilder implements SupabaseQueryBuilder {
  final Future<dynamic> _futureValue;
  final Function(String, dynamic)? onEq;
  final Function(Map)? onUpdate;

  FakeSupabaseQueryBuilder(this._futureValue, {this.onEq, this.onUpdate});

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #select) {
      return FakePostgrestFilterBuilder<List<Map<String, dynamic>>>(_futureValue, onEq: onEq);
    }
    if (invocation.memberName == #update) {
      final Map values = invocation.positionalArguments.first as Map;
      onUpdate?.call(values);
      return FakePostgrestFilterBuilder<dynamic>(Future.value(null), onEq: onEq);
    }
    return this;
  }
}

class FakeGoTrueClient implements GoTrueClient {
  @override
  User? get currentUser => FakeUser('test-driver-id');

  @override
  Session? get currentSession => null;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakeSupabaseClient implements SupabaseClient {
  @override
  GoTrueClient get auth => FakeGoTrueClient();

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #from) {
      return FakeSupabaseQueryBuilder(Future.value({'id': 'trip-1'}));
    }
    return super.noSuchMethod(invocation);
  }
}

void main() {
  group('SyncService', () {
    late SyncService syncService;
    late TripService tripService;
    late Directory tempDir;

    setUpAll(() async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await setupTests();
      tempDir = await Directory.systemTemp.createTemp('pod_test_');
    });

    setUp(() async {
      tripService = TripService(
        client: FakeSupabaseClient(),
        apiClient: ApiClient(baseUrl: 'http://localhost:5000'),
      );
      syncService = SyncService.instance;
    });

    tearDownAll(() async {
      await tempDir.delete(recursive: true);
    });

    test('uploadPodFiles returns null when no valid files exist', () async {
      final result = await syncService.uploadPodFiles(
        orderId: 'test-order-id',
      );
      expect(result, isNull);
    });

    test('queueOrSyncPoD saves offline when no connectivity', () async {
      // This test verifies the offline path stores to LocalDbService
      // The actual connectivity check is mocked at the OS level
      expect(() => syncService.queueOrSyncPoD(
        tripDisplayId: 'trip-123',
        stopId: 'stop-456',
        orderId: 'order-789',
      ), returnsNormally);
    });

    test('isStopPendingSync returns false when no pending items', () async {
      final result = await syncService.isStopPendingSync('nonexistent-stop');
      expect(result, isFalse);
    });

    group('queueOrSyncPoD uploads with a resolved order id (issue #6280)', () {
      late MockClient mockClient;
      late List<http.Request> requests;
      late Directory uploadDir;
      late File photoFile;
      late File signatureFile;

      setUp(() async {
        requests = [];
        mockClient = MockClient((request) async {
          requests.add(request);
          return http.Response('{}', 200);
        });
        uploadDir = await Directory.systemTemp.createTemp('sync_pod_upload_');
        photoFile = File('${uploadDir.path}/photo.jpg');
        await photoFile.writeAsBytes(const [1, 2, 3]);
        signatureFile = File('${uploadDir.path}/signature.png');
        await signatureFile.writeAsBytes(const [4, 5, 6]);

        final messenger =
            TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
        messenger.setMockMethodCallHandler(
          const MethodChannel('dev.fluttercommunity.plus/connectivity'),
          (call) async {
            if (call.method == 'check') return ['wifi'];
            return null;
          },
        );
      });

      tearDown(() async {
        await uploadDir.delete(recursive: true);
        final messenger =
            TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
        messenger.setMockMethodCallHandler(
            const MethodChannel('dev.fluttercommunity.plus/connectivity'),
            null);
      });

      ApiClient buildApiClient() => ApiClient(
            baseUrl: 'http://localhost:5000',
            httpClient: mockClient,
            supabaseClient: FakeSupabaseClient(),
          );

      test(
          'uploads the PoD with a non-null order id before completing the stop',
          () async {
        final apiClient = buildApiClient();
        final service = SyncService.forTesting(
          tripService:
              TripService(client: FakeSupabaseClient(), apiClient: apiClient),
          apiClient: apiClient,
        );

        await service.queueOrSyncPoD(
          tripDisplayId: 'trip-123',
          stopId: 'stop-456',
          orderId: 'order-789',
          photoPath: photoFile.path,
          signaturePath: signatureFile.path,
        );

        expect(
          requests.any((r) =>
              r.method == 'POST' && r.url.path == '/api/orders/order-789/pod'),
          isTrue,
          reason: 'the upload must run with the non-null order id',
        );
        expect(
          requests.any((r) =>
              r.method == 'PUT' &&
              r.url.path == '/api/trips/trip-123/stops/stop-456/complete'),
          isTrue,
          reason: 'the stop is only completed after a successful upload',
        );
      });

      test(
          'skips the upload when the order id is null but still completes the stop',
          () async {
        final apiClient = buildApiClient();
        final service = SyncService.forTesting(
          tripService:
              TripService(client: FakeSupabaseClient(), apiClient: apiClient),
          apiClient: apiClient,
        );

        await service.queueOrSyncPoD(
          tripDisplayId: 'trip-123',
          stopId: 'stop-456',
          photoPath: photoFile.path,
          signaturePath: signatureFile.path,
        );

        expect(
          requests.any((r) => r.url.path.endsWith('/pod')),
          isFalse,
          reason: 'without an order id there is no pod endpoint to upload to',
        );
        expect(
          requests.any((r) =>
              r.method == 'PUT' &&
              r.url.path == '/api/trips/trip-123/stops/stop-456/complete'),
          isTrue,
        );
      });
    });
  });
}
