import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:driver/services/marketplace_repository.dart';

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

      // Both subscribers receive their own independent stream.
      final receivedA = <LoadOffer>[];
      final receivedB = <LoadOffer>[];
      final subA = a.listen(receivedA.add);
      final subB = b.listen(receivedB.add);

      // Cancelling one subscription must NOT tear the shared channel down for
      // the other listener.
      await subA.cancel();

      // The still-active subscription must remain usable afterwards.
      expect(b, isA<Stream<LoadOffer>>());
      await subB.cancel();
    });

    test('cancelling one subscriber keeps the other alive (ref-counted channel)', () async {
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

      // Cancel only the first subscriber.
      await first.listen((_) {}).cancel();

      // The second subscription must still be open (not closed by the first
      // cancellation, since the channel is ref-counted).
      expect(subSecond.isPaused, isFalse);
      await subSecond.cancel();
      await secondActive.future.timeout(const Duration(seconds: 2));
    });
  });
}
