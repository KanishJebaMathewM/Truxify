import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:driver/services/marketplace_repository.dart';

/// A [RealtimeChannel] double that records the `onPostgresChanges` callback so
/// a test can synthesise a postgres insert without a live WebSocket, and that
/// returns `this` from [subscribe] so no network activity happens.
class FakeRealtimeChannel extends RealtimeChannel {
  FakeRealtimeChannel() : super('new_load_offers', const RealtimeChannelConfig());

  void Function(PostgresChangePayload)? _onPostgresChanges;

  @override
  RealtimeChannel onPostgresChanges({
    required PostgresChangeEvent event,
    required String schema,
    String? table,
    PostgresChangeFilter? filter,
    required void Function(PostgresChangePayload) callback,
  }) {
    _onPostgresChanges = callback;
    return this;
  }

  @override
  Future<void> subscribe([Duration? timeout]) => Future.value();

  /// Simulates a single `INSERT` on `load_offers`, driving the registered
  /// callback exactly once (as a real DB insert would).
  void emitPostgresInsert(Map<String, dynamic> record) {
    _onPostgresChanges?.call(
      PostgresChangePayload(
        eventType: PostgresChangeEvent.insert,
        newRecord: record,
        oldRecord: const <String, dynamic>{},
        schema: 'public',
        table: 'load_offers',
        commitTimestamp: DateTime.now(),
      ),
    );
  }
}

/// A [SupabaseClient] double that always returns the same [FakeRealtimeChannel]
/// (mirroring how Supabase keys `client.channel(topic)` by topic) and records
/// whether [removeChannel] was invoked.
class FakeSupabaseClient extends SupabaseClient {
  FakeSupabaseClient() : super('https://example.supabase.co', 'test-anon-key');

  final FakeRealtimeChannel fakeChannel = FakeRealtimeChannel();
  bool removeChannelCalled = false;

  @override
  RealtimeChannel channel(
    String topic, {
    RealtimeChannelConfig opts = const RealtimeChannelConfig(),
  }) =>
      fakeChannel;

  @override
  Future<void> removeChannel(RealtimeChannel channel) {
    removeChannelCalled = true;
    return Future.value();
  }
}

void main() {
  group('MarketplaceRepository.subscribeToNewLoads', () {
    test('returns an independent broadcast stream per subscriber', () async {
      final repo = MarketplaceRepository(
        client: SupabaseClient('https://example.supabase.co', 'test-anon-key'),
      );

      final a = repo.subscribeToNewLoads();
      final b = repo.subscribeToNewLoads();

      expect(a.isBroadcast, isTrue);
      expect(b.isBroadcast, isTrue);

      final receivedA = <LoadOffer>[];
      final receivedB = <LoadOffer>[];
      final subA = a.listen(receivedA.add);
      final subB = b.listen(receivedB.add);

      // Cancelling one subscription must NOT tear the shared channel down for
      // the other listener.
      await subA.cancel();

      expect(b, isA<Stream<LoadOffer>>());
      await subB.cancel();
    });

    test('cancelling one subscriber keeps the other alive (ref-counted channel)',
        () async {
      final repo = MarketplaceRepository(
        client: SupabaseClient('https://example.supabase.co', 'test-anon-key'),
      );

      final first = repo.subscribeToNewLoads();
      final second = repo.subscribeToNewLoads();

      final secondActive = Completer<void>();
      final subSecond = second.listen(
        (_) {},
        onDone: () => secondActive.complete(),
      );

      await first.listen((_) {}).cancel();

      expect(subSecond.isPaused, isFalse);
      await subSecond.cancel();
      await secondActive.future.timeout(const Duration(seconds: 2));
    });

    test(
        'N subscribers each receive exactly one event per insert; '
        'cancelling one keeps the others alive', () async {
      final fakeClient = FakeSupabaseClient();
      final repo = MarketplaceRepository(client: fakeClient);

      const subscriberCount = 3;
      final received = <List<LoadOffer>>[];
      final subscriptions = <StreamSubscription<LoadOffer>>[];

      for (var i = 0; i < subscriberCount; i++) {
        final list = <LoadOffer>[];
        received.add(list);
        subscriptions.add(repo.subscribeToNewLoads().listen(list.add));
      }

      // A single DB insert must be delivered exactly once to every subscriber,
      // not duplicated across the shared channel.
      fakeClient.fakeChannel
          .emitPostgresInsert(<String, dynamic>{'id': 'load-1', 'status': 'available'});
      await Future.delayed(Duration.zero);

      for (var i = 0; i < subscriberCount; i++) {
        expect(received[i], hasLength(1),
            reason: 'subscriber $i should receive exactly one event');
      }

      // Cancel one subscriber; the shared channel must remain for the rest.
      await subscriptions[0].cancel();
      expect(fakeClient.removeChannelCalled, isFalse,
          reason: 'channel must not be torn down while others are active');

      // A second insert is delivered to the survivors but not the cancelled one.
      fakeClient.fakeChannel
          .emitPostgresInsert(<String, dynamic>{'id': 'load-2', 'status': 'available'});
      await Future.delayed(Duration.zero);

      expect(received[0], hasLength(1),
          reason: 'cancelled subscriber must not receive further events');
      expect(received[1], hasLength(2),
          reason: 'surviving subscriber must keep receiving');
      expect(received[2], hasLength(2),
          reason: 'surviving subscriber must keep receiving');

      // Tidy up the remaining subscriptions.
      for (var i = 1; i < subscriptions.length; i++) {
        await subscriptions[i].cancel();
      }

      // Now the last subscriber is gone, the channel may be released.
      expect(fakeClient.removeChannelCalled, isTrue,
          reason: 'channel should be released after the last subscriber cancels');
    });
  });
}
