import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:workmanager/workmanager.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'pod_storage_service.dart';
import 'pod_sync_runner.dart';
import 'pod_upload_transport.dart';
import 'secure_storage.dart';

const syncTaskName = 'syncPendingPods';

@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    if (task == syncTaskName) await BackgroundSyncService.syncPods();
    return true;
  });
}

class BackgroundSyncService {
  static bool _syncTaskRegistered = false;
  static bool _syncing = false;
  static Timer? _debounce;
  static StreamSubscription<List<ConnectivityResult>>?
  _connectivitySubscription;
  static final ValueNotifier<PodSyncMetrics?> metrics = ValueNotifier(null);

  @visibleForTesting
  static void Function()? scheduleTaskOverride;

  @visibleForTesting
  static Future<void> Function()? syncOverride;

  static void initialize() {
    Workmanager().initialize(callbackDispatcher);
  }

  static void registerSyncTask() {
    if (_syncTaskRegistered) return;
    _syncTaskRegistered = true;
    final schedule = scheduleTaskOverride;
    if (schedule != null) {
      schedule();
      return;
    }
    Workmanager().registerPeriodicTask(
      'periodic_pod_sync',
      syncTaskName,
      frequency: const Duration(minutes: 15),
      constraints: Constraints(networkType: NetworkType.connected),
    );
  }

  static void listenForConnectivity() {
    _connectivitySubscription ??= Connectivity().onConnectivityChanged.listen(
      connectivityChanged,
    );
    unawaited(refreshMetrics());
  }

  @visibleForTesting
  static void connectivityChanged(List<ConnectivityResult> results) {
    _debounce?.cancel();
    if (results.any((result) => result != ConnectivityResult.none)) {
      _debounce = Timer(
        const Duration(seconds: 30),
        () => unawaited(syncPods()),
      );
    }
  }

  static Future<void> refreshMetrics() async {
    try {
      metrics.value = await podStorageService.metrics();
    } catch (error) {
      debugPrint('POD metrics unavailable (${error.runtimeType})');
    }
  }

  static Future<String?> _token(bool refresh) async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user != null) return await user.getIdToken(refresh);
      final auth = Supabase.instance.client.auth;
      return refresh
          ? (await auth.refreshSession()).session?.accessToken
          : auth.currentSession?.accessToken;
    } catch (_) {
      // An isolate without initialized providers can use the existing OS-backed
      // token. Never reuse it as a pretend successful refresh after a 401.
      return refresh ? null : AuthTokenStore.read();
    }
  }

  /// Release uploads require HTTPS. Plain HTTP is restricted to literal
  /// loopback development endpoints; hostname resolution is not a trust check.
  @visibleForTesting
  static Uri? uploadBaseUri(String value, {bool debug = kDebugMode}) {
    final uri = Uri.tryParse(value);
    if (uri == null || uri.host.isEmpty || uri.userInfo.isNotEmpty) return null;
    if (uri.scheme == 'https') return uri;
    final loopback = ['localhost', '127.0.0.1', '::1'].contains(uri.host);
    return debug && uri.scheme == 'http' && loopback ? uri : null;
  }

  static Future<void> syncPods() async {
    if (_syncing) return;
    _syncing = true;
    try {
      if (syncOverride != null) {
        await syncOverride!();
        return;
      }
      const envUrl = String.fromEnvironment('TRUXIFY_API_BASE_URL');
      final uri = uploadBaseUri(envUrl);
      if (uri == null) {
        debugPrint('POD sync requires HTTPS (debug loopback HTTP is allowed).');
        return;
      }
      final transport = PodUploadTransport(uri);
      await PodSyncRunner(
        storage: podStorageService,
        token: _token,
        upload: transport.upload,
      ).run();
    } catch (error) {
      debugPrint('POD sync paused (${error.runtimeType})');
    } finally {
      _syncing = false;
      await refreshMetrics();
    }
  }
}
