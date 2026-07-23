import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'local_db_service.dart';
import 'trip_service.dart';
import 'api_client.dart';

typedef UploadProgressCallback = void Function(String status, {double? progress});

class SyncService {
  static final SyncService instance = SyncService._init();
  final TripService _tripService = TripService();
  final ApiClient _apiClient = ApiClient();
  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  bool _isSyncing = false;

  SyncService._init();

  void startListening() {
    _connectivitySubscription = Connectivity().onConnectivityChanged.listen((List<ConnectivityResult> results) {
      if (!results.contains(ConnectivityResult.none)) {
        _syncPendingData();
      }
    });
  }

  void stopListening() {
    _connectivitySubscription?.cancel();
  }

  Future<void> _syncPendingData() async {
    if (_isSyncing) return;
    _isSyncing = true;
    try {
      final pendingPoDs = await LocalDbService.instance.getPendingPoDs();
      for (final pod in pendingPoDs) {
        final orderId = pod['order_id'] as String?;
        final stopId = pod['stop_id'] as String;
        final tripId = pod['trip_display_id'] as String;
        final photoPath = pod['photo_path'] as String?;
        final signaturePath = pod['signature_path'] as String?;
        final podId = pod['id'] as int;

        try {
          if (orderId != null && (photoPath != null || signaturePath != null)) {
            await _uploadPodFiles(orderId!, photoPath: photoPath, signaturePath: signaturePath);
          }
          await _tripService.markStopCompleted(stopId, tripId);
          await LocalDbService.instance.markPoDSynced(podId);
        } catch (e) {
          debugPrint('Failed to sync PoD $podId: $e');
        try {
          final stopId = pod['stop_id'] as String;
          final tripId = pod['trip_display_id'] as String;
          await _tripService.markStopCompleted(stopId, tripId);
          await LocalDbService.instance.markPoDSynced(pod['id'] as int);
        } catch (e) {
          debugPrint('Failed to sync pod ${pod['id']}: $e');
        }
      }
      debugPrint('Sync completed for ${pendingPoDs.length} items.');
    } catch (e) {
      debugPrint('Error during background sync: $e');
    } finally {
      _isSyncing = false;
    }
  }

  Future<Map<String, dynamic>?> uploadPodFiles({
    required String orderId,
    String? photoPath,
    String? signaturePath,
  }) async {
    return _uploadPodFiles(orderId, photoPath: photoPath, signaturePath: signaturePath);
  }

  Future<Map<String, dynamic>?> _uploadPodFiles(
    String orderId, {
    String? photoPath,
    String? signaturePath,
  }) async {
    final hasPhoto = photoPath != null && await File(photoPath).exists();
    final hasSignature = signaturePath != null && await File(signaturePath).exists();

    if (!hasPhoto && !hasSignature) {
      debugPrint('No valid files to upload for order $orderId');
      return null;
    }

    final files = <MultipartFileInfo>[];

    if (hasSignature) {
      final file = File(signaturePath!);
      final bytes = await file.readAsBytes();
      files.add(MultipartFileInfo(
        fieldName: 'signature',
        bytes: bytes,
        fileName: 'signature_${orderId}_${DateTime.now().millisecondsSinceEpoch}.png',
      ));
    }

    if (hasPhoto) {
      final file = File(photoPath!);
      final bytes = await file.readAsBytes();
      files.add(MultipartFileInfo(
        fieldName: 'photo',
        bytes: bytes,
        fileName: 'photo_${orderId}_${DateTime.now().millisecondsSinceEpoch}.jpg',
      ));
    }

    final response = await _apiClient.postMultipart(
      '/api/orders/$orderId/pod',
      fields: {},
      files: files,
    );

    return response as Map<String, dynamic>?;
  }

  Future<void> queueOrSyncPoD({
    required String tripDisplayId,
    required String stopId,
    String? orderId,
    String? photoPath,
    String? signaturePath,
    UploadProgressCallback? onProgress,
  }) async {
    final connectivity = await Connectivity().checkConnectivity();
    final isOffline = connectivity.contains(ConnectivityResult.none);

    if (isOffline) {
      onProgress?.call('Saving offline...');
      await LocalDbService.instance.insertPendingPoD({
        'order_id': orderId,
        'trip_display_id': tripDisplayId,
        'stop_id': stopId,
        'photo_path': photoPath,
        'signature_path': signaturePath,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
        'sync_status': 0,
      });
      debugPrint('PoD saved locally for offline sync.');
      return;
    }

    onProgress?.call('Uploading files...');
    try {
      if (orderId != null && (photoPath != null || signaturePath != null)) {
        await _uploadPodFiles(orderId, photoPath: photoPath, signaturePath: signaturePath);
        onProgress?.call('Upload complete, marking stop...');
      }
      await _tripService.markStopCompleted(stopId, tripDisplayId);
      onProgress?.call('Done');
    } catch (e) {
      debugPrint('Immediate sync failed: $e');
      onProgress?.call('Sync failed, saving offline...');
      await LocalDbService.instance.insertPendingPoD({
        'order_id': orderId,
        'trip_display_id': tripDisplayId,
        'stop_id': stopId,
        'photo_path': photoPath,
        'signature_path': signaturePath,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
        'sync_status': 0,
      });
      debugPrint('Immediate sync failed, saved PoD locally.');
    }
  }

  Future<bool> isStopPendingSync(String stopId) async {
    final pending = await LocalDbService.instance.getPendingPoDs();
    return pending.any((pod) => pod['stop_id'] == stopId);
  }
}
