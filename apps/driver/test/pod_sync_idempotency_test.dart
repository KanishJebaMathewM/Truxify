import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:truxify_driver/services/sync_service.dart';
import 'package:truxify_driver/services/api_client.dart';
import 'package:truxify_driver/services/local_db_service.dart';
import 'package:truxify_driver/services/trip_service.dart';
import 'setup.dart';

/// A [TripService] whose [markStopCompleted] fails on the first call and
/// succeeds on every subsequent call. Used to simulate the partial-failure
/// scenario: upload succeeds, completion fails, then the retry succeeds.
class FlakyTripService extends TripService {
  FlakyTripService({required ApiClient apiClient})
      : super(apiClient: apiClient);

  int markStopCompletedCalls = 0;

  @override
  Future<void> markStopCompleted(String stopId, String tripDisplayId) async {
    markStopCompletedCalls += 1;
    if (markStopCompletedCalls == 1) {
      throw Exception('transient network error');
    }
  }
}

void main() {
  group('PoD sync idempotency (issue #11447)', () {
    late Directory tempDir;
    late Directory uploadDir;
    late File photoFile;
    late File signatureFile;
    late List<http.Request> requests;
    late MockClient mockClient;
    late ApiClient apiClient;
    late FlakyTripService tripService;
    late SyncService syncService;

    late int insertedPodId;

    setUpAll(() async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await setupTests();
      tempDir = await Directory.systemTemp.createTemp('pod_idem_');
    });

    setUp(() async {
      requests = [];
      mockClient = MockClient((request) async {
        requests.add(request);
        return http.Response('{}', 200);
      });
      apiClient = ApiClient(
        baseUrl: 'http://localhost:5000',
        httpClient: mockClient,
      );
      tripService = FlakyTripService(apiClient: apiClient);
      syncService = SyncService.forTesting(
        tripService: tripService,
        apiClient: apiClient,
      );

      uploadDir = await Directory.systemTemp.createTemp('pod_idem_upload_');
      photoFile = File('${uploadDir.path}/photo.jpg');
      await photoFile.writeAsBytes(const [1, 2, 3]);
      signatureFile = File('${uploadDir.path}/signature.png');
      await signatureFile.writeAsBytes(const [4, 5, 6]);

      await LocalDbService.instance.insertPendingPoD({
        'order_id': 'order-11447',
        'trip_display_id': 'trip-11447',
        'stop_id': 'stop-11447',
        'photo_path': photoFile.path,
        'signature_path': signatureFile.path,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
        'sync_status': 0,
      });

      final pending = await LocalDbService.instance.getPendingPoDs();
      insertedPodId = pending
          .firstWhere((p) => p['order_id'] == 'order-11447')['id'] as int;
    });

    tearDown(() async {
      await LocalDbService.instance.deletePendingPoD(insertedPodId);
      await uploadDir.delete(recursive: true);
    });

    tearDownAll(() async {
      await tempDir.delete(recursive: true);
    });

    test(
        'uploads the PoD file exactly once when markStopCompleted fails then '
        'succeeds', () async {
      await syncService.syncPendingDataForTesting();

      final podUploads = requests
          .where((r) =>
              r.method == 'POST' &&
              r.url.path == '/api/orders/order-11447/pod')
          .toList();

      expect(
        podUploads.length,
        1,
        reason: 'the signature/photo must be uploaded exactly once even when '
            'markStopCompleted fails on the first attempt',
      );

      // The stop completion is attempted twice (initial + retry) and the local
      // row must end up marked synced.
      expect(tripService.markStopCompletedCalls, 2);

      final pending = await LocalDbService.instance.getPendingPoDs();
      final synced = pending.where((p) => p['id'] == insertedPodId);
      expect(synced.isEmpty, isTrue,
          reason: 'the completed pod must be removed from the pending set');
    });
  });
}
