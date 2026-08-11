import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_shared/truxify_shared.dart';
import 'package:truxify_driver/services/location_replay_service.dart';
import 'package:truxify_driver/services/offline_location_queue.dart';

import 'offline_location_queue_test.dart'
    show FakeLocationQueueStore, dataOf, loc;

void main() {
  late FakeLocationQueueStore store;
  late OfflineLocationQueue queue;
  late LocationReplayService replay;
  late List<Map<String, dynamic>> sent;
  WsSendResult Function(Map<String, dynamic>)? locationSender;
  bool Function()? connected;

  setUp(() {
    store = FakeLocationQueueStore();
    queue = OfflineLocationQueue(store: store);
    sent = [];
    locationSender = null;
    connected = null;
    replay = LocationReplayService(
      queue: queue,
      sendLocation: (m) {
        sent.add(m);
        return locationSender?.call(m) ?? WsSendResult.delivered;
      },
      sendMilestone:
          ({required orderId, required milestone, required token}) async {
        sent.add({
          'event': 'milestone',
          'data': {'orderId': orderId, 'milestone': milestone},
        });
        return true;
      },
      tokenProvider: () => 'test-token',
      driverIdProvider: () => 'driver-1',
      isConnected: () => connected?.call() ?? true,
    );
    LocationReplayService.replayDelay = Duration.zero;
  });

  tearDown(() {
    LocationReplayService.replayDelay = const Duration(milliseconds: 250);
  });

  group('LocationReplayService happy path', () {
    test('replays queued locations and removes them after delivery', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      await queue.enqueueLocation(loc(lat: 21.01, lng: 72.01));

      await replay.kick();

      expect(sent, hasLength(2));
      expect(sent[0]['data']['lat'], 21.0);
      expect(sent[1]['data']['lat'], 21.01);
      expect(await queue.count(), 0, reason: 'delivered items are removed');
      expect(replay.state, LocationReplayState.idle);
    });

    test('replays milestones via sendMilestone', () async {
      await queue.enqueueMilestone(
        orderId: 'order-1',
        milestone: 'Arrived at Pickup',
        driverId: 'driver-1',
      );

      await replay.kick();

      expect(sent, hasLength(1));
      expect(sent.first['data']['milestone'], 'Arrived at Pickup');
      expect(await queue.count(), 0);
    });

    test('a fresh replay service drains what a previous one left behind', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));

      final restarted = LocationReplayService(
        queue: queue,
        sendLocation: (m) {
          sent.add(m);
          return WsSendResult.delivered;
        },
        sendMilestone:
            ({required orderId, required milestone, required token}) async {
          return true;
        },
        driverIdProvider: () => 'driver-1',
      );
      await restarted.kick();

      expect(sent, hasLength(1));
      expect(await queue.count(), 0);
    });
  });

  group('LocationReplayService failure handling', () {
    test('failed delivery is left in the queue and replay stops', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      await queue.enqueueLocation(loc(lat: 21.01, lng: 72.01));
      locationSender = (_) => WsSendResult.failed;

      await replay.kick();

      expect(await queue.count(), 2, reason: 'nothing may be dropped on failure');
      expect(replay.state, LocationReplayState.idle);
    });

    test('connection dropped mid-replay stops and keeps the remainder', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      await queue.enqueueLocation(loc(lat: 21.01, lng: 72.01));
      await queue.enqueueLocation(loc(lat: 21.02, lng: 72.02));
      var call = 0;
      locationSender = (_) {
        call += 1;
        // First delivery succeeds, then the socket drops.
        return call == 1 ? WsSendResult.delivered : WsSendResult.failed;
      };

      await replay.kick();

      expect(call, 2);
      expect(await queue.count(), 2, reason: 'undelivered items survive');
      expect(replay.state, LocationReplayState.idle);
    });

    test('replay aborts when the transport drops before delivery', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      connected = () => false;

      await replay.kick();

      expect(sent, isEmpty);
      expect(await queue.count(), 1, reason: 'items stay queued while offline');
    });

    test('driver-mismatched entry is skipped without being dropped', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0, driverId: 'driver-1'));
      await queue.enqueueLocation(loc(lat: 21.01, lng: 72.01, driverId: 'other'));

      await replay.kick();

      // The foreign entry is neither delivered nor deleted.
      expect(sent, hasLength(1));
      expect(await queue.count(), 1);
      final remaining = await queue.pending();
      expect(dataOf(remaining.single.payload)['driver_id'], 'other');
    });
  });

  group('LocationReplayService exactly-once removal', () {
    test('only a delivered result removes the item; anything else keeps it', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      locationSender = (_) => WsSendResult.failed;

      await replay.kick();

      expect(await queue.count(), 1, reason: 'only delivered is removed');
      expect(replay.state, LocationReplayState.idle);
    });
  });

  group('LocationReplayService single-worker guarantee', () {
    test('concurrent kicks do not run parallel replays', () async {
      await queue.enqueueLocation(loc(lat: 21.0, lng: 72.0));
      await queue.enqueueLocation(loc(lat: 21.01, lng: 72.01));
      await queue.enqueueLocation(loc(lat: 21.02, lng: 72.02));

      final first = replay.kick();
      final second = replay.kick(); // must no-op while first is running
      await Future.wait([first, second]);

      expect(sent, hasLength(3), reason: 'each item is sent exactly once');
      expect(await queue.count(), 0);
    });
  });
}
