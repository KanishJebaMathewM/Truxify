import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:workmanager/workmanager.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'pod_storage_service.dart';

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
  static void initialize() {
    Workmanager().initialize(
      callbackDispatcher,
      isInDebugMode: true,
    );
  }

  static void registerSyncTask() {
    Workmanager().registerOneOffTask(
      'sync_pods_task',
      syncTaskName,
      constraints: Constraints(
        networkType: NetworkType.connected,
      ),
    );
  }

  static Future<void> syncPods() async {
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
      // Firebase/Supabase not initialized in background isolate.
      // Token should be persisted to SharedPreferences for background sync.
    }

    if (token == null) return; // Cannot sync without auth

    const envUrl = String.fromEnvironment('TRUXIFY_API_BASE_URL');
    assert(envUrl.isNotEmpty, 'TRUXIFY_API_BASE_URL must be set for release builds');
    
    for (final pod in pendingPods) {
      try {
        final uri = Uri.parse('$envUrl/api/orders/${pod.orderId}/pod');
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
        // Will retry next time
      }
    }
  }
}
