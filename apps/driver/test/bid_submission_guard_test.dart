import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/bid_submission_guard.dart';

void main() {
  test('prevents duplicate submissions for the same load while in flight', () async {
    final guard = BidSubmissionGuard();
    var callCount = 0;

    Future<int> action() async {
      callCount += 1;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      return callCount;
    }

    final first = guard.run(loadId: 'load-1', action: action);

    await expectLater(
      guard.run(loadId: 'load-1', action: action),
      throwsA(isA<StateError>()),
    );

    expect(await first, 1);
    expect(callCount, 1);
  });
}
