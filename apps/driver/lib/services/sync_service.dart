import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'local_db_service.dart';
import 'trip_service.dart';

class SyncService {
  static final SyncService instance = SyncService._init();
  final TripService _tripService = TripService();
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

  Future<void> queueOrSyncPoD({
    required String tripDisplayId,
    required String stopId,
    String? photoPath,
    String? signaturePath,
  }) async {
    final connectivity = await Connectivity().checkConnectivity();
    if (connectivity.contains(ConnectivityResult.none)) {
      // Offline: save to local DB
      await LocalDbService.instance.insertPendingPoD({
        'trip_display_id': tripDisplayId,
        'stop_id': stopId,
        'photo_path': photoPath,
        'signature_path': signaturePath,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
        'sync_status': 0, // 0 = pending, 1 = synced
      });
      debugPrint('PoD saved locally for offline sync.');
    } else {
      // Online: try immediate sync
      try {
        await _tripService.markStopCompleted(stopId, tripDisplayId);
      } catch (e) {
        // If API fails (e.g. server down), save locally
        await LocalDbService.instance.insertPendingPoD({
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
  }

  Future<bool> isStopPendingSync(String stopId) async {
    final pending = await LocalDbService.instance.getPendingPoDs();
    return pending.any((pod) => pod['stop_id'] == stopId);
  }
}
