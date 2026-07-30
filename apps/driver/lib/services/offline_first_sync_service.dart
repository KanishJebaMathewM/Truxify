import 'dart:async';
import '../models/offline_sync_event_model.dart';

class OfflineFirstSyncService {
  final List<OfflineSyncEvent> _localDatabase = [];
  bool _isConnected = false;
  final StreamController<bool> _connectionController = StreamController<bool>.broadcast();
  final StreamController<List<OfflineSyncEvent>> _dbController = StreamController<List<OfflineSyncEvent>>.broadcast();

  Stream<bool> get connectionStream => _connectionController.stream;
  Stream<List<OfflineSyncEvent>> get databaseStream => _dbController.stream;

  /// Simulates queueing data into local storage (like SQLite/Hive) while offline
  void queueEvent(String type, Map<String, dynamic> data) {
    final event = OfflineSyncEvent(
      eventId: 'EVT-${DateTime.now().millisecondsSinceEpoch}',
      eventType: type,
      payload: data,
      queuedAt: DateTime.now(),
    );
    _localDatabase.add(event);
    _dbController.add(List.from(_localDatabase));
    
    if (_isConnected) {
      _processSyncQueue();
    }
  }

  /// Toggles network state to demonstrate offline-first resilience
  void toggleNetwork(bool isOnline) {
    _isConnected = isOnline;
    _connectionController.add(_isConnected);
    if (_isConnected) {
      _processSyncQueue();
    }
  }

  Future<void> _processSyncQueue() async {
    for (int i = 0; i < _localDatabase.length; i++) {
      if (!_localDatabase[i].isSynced) {
        // Simulate API network call delay
        await Future.delayed(const Duration(milliseconds: 800));
        
        // Update local record to synced
        _localDatabase[i] = OfflineSyncEvent(
          eventId: _localDatabase[i].eventId,
          eventType: _localDatabase[i].eventType,
          payload: _localDatabase[i].payload,
          queuedAt: _localDatabase[i].queuedAt,
          isSynced: true,
          syncedAt: DateTime.now(),
        );
        _dbController.add(List.from(_localDatabase));
      }
    }
  }
}
