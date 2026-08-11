import 'dart:async';
import 'dart:io';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:workmanager/workmanager.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'pod_storage_service.dart';
import 'secure_storage.dart';

const syncTaskName = 'syncPendingPods';

@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    if (task == syncTaskName) {
      await BackgroundSyncService.syncPods();
    }
    return Future.value(true);
  });
}

class BackgroundSyncService {
  static bool _syncTaskRegistered = false;
  static bool _syncing = false;
  static StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;

  /// Test hook: replaces the Workmanager scheduling call so tests can assert
  /// the task is registered exactly once without a platform channel.
  @visibleForTesting
  static void Function()? scheduleTaskOverride;

  static void initialize() {
    Workmanager().initialize(
      callbackDispatcher,
      isInDebugMode: kDebugMode,
    );
  }

  static void registerSyncTask() {
    if (_syncTaskRegistered) return;
    _syncTaskRegistered = true;
    final schedule = scheduleTaskOverride;
    if (schedule != null) {
      schedule();
      return;
    }
    Workmanager().registerOneOffTask(
      'sync_pods_task',
      syncTaskName,
      constraints: Constraints(
        networkType: NetworkType.connected,
      ),
    );
  }

  /// Syncs offline-saved pods as soon as connectivity returns, so they do not
  /// wait for the next OS-scheduled background run.
  static void listenForConnectivity() {
    _connectivitySubscription ??= Connectivity()
        .onConnectivityChanged
        .listen((results) {
      if (!results.contains(ConnectivityResult.none)) {
        syncPods();
      }
    });
  }

  static Future<void> syncPods() async {
    if (_syncing) return;
    _syncing = true;
    try {
      final pendingPods = await podStorageService.getUnsyncedPods();
      if (pendingPods.isEmpty) return;

      String? token;
      try {
        final firebaseUser = FirebaseAuth.instance.currentUser;
        if (firebaseUser != null) {
          token = await firebaseUser.getIdToken();
        } else {
          token = Supabase.instance.client.auth.currentSession?.accessToken;
        }
      } catch (_) {
        // Firebase/Supabase are not initialized in the background isolate.
        // Fall back to the auth token persisted by the main isolate in
        // OS-backed secure storage (issue #5739) — never SharedPreferences.
        token = await AuthTokenStore.read();
      }

      if (token == null || token.isEmpty) return;

      const envUrl = String.fromEnvironment('TRUXIFY_API_BASE_URL');
      final apiBaseUri = Uri.tryParse(envUrl);
      if (apiBaseUri == null ||
          !apiBaseUri.hasScheme ||
          apiBaseUri.host.isEmpty) {
        stderr.writeln(
          'TRUXIFY_API_BASE_URL must be set to an absolute URL for background POD sync.',
        );
        return;
      }
      
      for (final pod in pendingPods) {
        try {
          final uri = apiBaseUri.replace(
            path: '${apiBaseUri.path}/api/orders/${pod.orderId}/pod'
                .replaceAll(RegExp(r'/+'), '/'),
            query: null,
            fragment: null,
          );
          final request = http.MultipartRequest('POST', uri);
          request.headers['Authorization'] = 'Bearer $token';

          if (pod.signaturePath != null) {
            final file = File(pod.signaturePath!);
            if (await file.exists()) {
              request.files.add(await http.MultipartFile.fromPath(
                'signature',
                file.path,
                contentType: MediaType('image', 'png'),
              ));
            }
          }

          if (pod.photoPath != null) {
            final file = File(pod.photoPath!);
            if (await file.exists()) {
              request.files.add(await http.MultipartFile.fromPath(
                'photo',
                file.path,
                contentType: MediaType('image', 'jpeg'),
              ));
            }
          }

          final response = await request.send();
          if (response.statusCode >= 200 && response.statusCode < 300) {
            await podStorageService.markAsSynced(pod.id!);
          }
        } catch (e) {
          // Will retry on next background sync
        }
      }
    } finally {
      _syncing = false;
    }
  }
}
