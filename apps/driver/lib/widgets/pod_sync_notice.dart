import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';

import '../services/pod_storage_service.dart';

/// Foreground notification; background isolates update SQLite, not UI channels.
class PodSyncNotice extends StatelessWidget {
  final Widget child;
  final GlobalKey<NavigatorState> navigatorKey;
  final ValueListenable<PodSyncMetrics?> metrics;
  final PodStorageService storage;
  final Future<void> Function() retry;
  const PodSyncNotice({
    super.key,
    required this.child,
    required this.metrics,
    required this.storage,
    required this.retry,
    required this.navigatorKey,
  });

  Future<void> _review(BuildContext context) async {
    final letters = await storage.deadLetters();
    if (!context.mounted || navigatorKey.currentContext == null) return;
    await showDialog<void>(
      context: navigatorKey.currentContext!,
      builder: (context) => AlertDialog(
        title: const Text('POD uploads needing review'),
        content: SizedBox(
          width: 360,
          child: ListView(
            shrinkWrap: true,
            children: [
              if (letters.isEmpty)
                const Text('No failed uploads needing manual review.'),
              for (final row in letters)
                ListTile(
                  title: Text('Order ${row['order_id']}'),
                  subtitle: Text(
                    '${row['attempts']} attempts: ${row['last_error']}',
                  ),
                  trailing: TextButton(
                    child: const Text('Retry'),
                    onPressed: () async {
                      await storage.requeue(row['pod_id'] as int);
                      if (context.mounted) Navigator.pop(context);
                      await retry();
                    },
                  ),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<PodSyncMetrics?>(
    valueListenable: metrics,
    builder: (context, value, _) => Column(
      children: [
        if (value != null &&
            (value.retryingCount > 0 || value.deadLetterCount > 0))
          SafeArea(
            bottom: false,
            child: Material(
              color: Colors.amber.shade100,
              child: ListTile(
                title: Text(
                  'POD uploads: ${value.pendingCount} pending, ${value.retryingCount} retrying, '
                  '${value.deadLetterCount} need review',
                ),
                subtitle: value.lastSuccess == null
                    ? null
                    : Text(
                        'Last upload: ${DateTime.fromMillisecondsSinceEpoch(value.lastSuccess!).toLocal()}',
                      ),
                trailing: TextButton(
                  onPressed: () => _review(context),
                  child: const Text('Review'),
                ),
              ),
            ),
          ),
        Expanded(child: child),
      ],
    ),
  );
}
