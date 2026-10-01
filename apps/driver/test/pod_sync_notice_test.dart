import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/pod_storage_service.dart';
import 'package:truxify_driver/widgets/pod_sync_notice.dart';

class _Storage extends PodStorageService {
  int? requeued;
  @override
  Future<List<Map<String, Object?>>> deadLetters() async => [
    {
      'pod_id': 7,
      'order_id': 'order-7',
      'attempts': 10,
      'last_error': 'HTTP 503',
    },
  ];
  @override
  Future<bool> requeue(int id) async {
    requeued = id;
    return true;
  }
}

void main() {
  testWidgets(
    'foreground banner opens manual review through the app navigator',
    (tester) async {
      final metrics = ValueNotifier<PodSyncMetrics?>(
        const PodSyncMetrics(1, 2, 1, null),
      );
      final key = GlobalKey<NavigatorState>();
      final storage = _Storage();
      var retried = 0;
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: key,
          builder: (context, child) => PodSyncNotice(
            child: child!,
            metrics: metrics,
            storage: storage,
            navigatorKey: key,
            retry: () async {
              retried++;
            },
          ),
          home: const Scaffold(body: Text('Delivery screen')),
        ),
      );
      expect(
        find.text('POD uploads: 1 pending, 2 retrying, 1 need review'),
        findsOneWidget,
      );
      await tester.tap(find.text('Review'));
      await tester.pumpAndSettle();
      expect(find.text('Order order-7'), findsOneWidget);
      expect(find.text('10 attempts: HTTP 503'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      expect(storage.requeued, 7);
      expect(retried, 1);
      metrics.value = const PodSyncMetrics(0, 0, 0, 123);
      await tester.pump();
      expect(find.text('Review'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      metrics.dispose();
    },
  );
}
