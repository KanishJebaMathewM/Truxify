import 'pod_storage_service.dart';

/// Credentials are resolved before admission. Auth failures pause the batch;
/// they are not evidence that the driver's delivery document is invalid.
class PodSyncRunner {
  final PodStorageService storage;
  final Future<String?> Function(bool refresh) token;
  final Future<int> Function(PodRecord pod, String token) upload;
  final int Function() now;
  PodSyncRunner({
    required this.storage,
    required this.token,
    required this.upload,
    int Function()? now,
  }) : now = now ?? (() => DateTime.now().millisecondsSinceEpoch);

  Future<void> run({int batchSize = 20}) async {
    final startedAt = now();
    var credential = await token(false).timeout(const Duration(seconds: 10));
    if (credential == null || credential.isEmpty) return;
    for (var i = 0; i < batchSize; i++) {
      if (now() - startedAt >= const Duration(minutes: 2).inMilliseconds) break;
      final pod = await storage.claimDue(now());
      if (pod == null) break;
      try {
        var status = await upload(pod, credential!);
        if (status == 401) {
          try {
            credential = await token(true).timeout(const Duration(seconds: 10));
          } catch (_) {
            credential = null;
          }
          if (credential != null && credential.isNotEmpty)
            status = await upload(pod, credential);
        }
        if (status == 401 || status == 403) {
          await storage.pauseForAuth(pod, now());
          break;
        }
        if (status >= 200 && status < 300) {
          await storage.complete(pod, now());
        } else {
          await storage.fail(pod, now(), 'HTTP $status');
        }
      } catch (error) {
        // Do not persist credentials, response bodies, file paths or provider text.
        await storage.fail(pod, now(), 'Upload failed (${error.runtimeType})');
      }
    }
  }
}
