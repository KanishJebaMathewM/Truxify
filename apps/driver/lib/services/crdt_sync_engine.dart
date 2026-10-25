import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../models/crdt_model.dart';

/// Offline-First CRDT State Synchronization Engine for the Driver App.
class CrdtSyncEngine {
  static final CrdtSyncEngine _instance = CrdtSyncEngine._internal();
  factory CrdtSyncEngine() => _instance;

  final String _nodeId = 'driver_node_${DateTime.now().millisecondsSinceEpoch}';
  late HybridLogicalClock _clock;

  final List<CrdtMutation> _pendingQueue = [];
  final Map<String, dynamic> _localMergedState = {};
  bool _isSyncing = false;
  Timer? _autoSyncTimer;

  static String get _apiBaseUrl {
    const envUrl = String.fromEnvironment('TRUXIFY_API_BASE_URL');
    if (envUrl.isNotEmpty) return envUrl;
    if (kIsWeb) return 'http://localhost:5000';
    if (Platform.isAndroid) return 'http://10.0.2.2:5000';
    return 'http://localhost:5000';
  }

  CrdtSyncEngine._internal() {
    _clock = HybridLogicalClock.now(_nodeId);
    _startPeriodicSync();
  }

  HybridLogicalClock get currentClock => _clock;
  int get pendingMutationCount => _pendingQueue.length;

  /// Records a local state mutation while offline or online.
  Future<CrdtMutation> recordMutation({
    required String entityType,
    required String entityId,
    required String fieldKey,
    required dynamic value,
    bool isDeleted = false,
  }) async {
    _clock = _clock.send();

    final mutationId = 'mut_${DateTime.now().millisecondsSinceEpoch}_${_clock.counter}';
    final idempotencyKey = '${_nodeId}_${entityType}_${entityId}_${fieldKey}_${_clock.packToString()}';

    final mutation = CrdtMutation(
      mutationId: mutationId,
      entityType: entityType,
      entityId: entityId,
      fieldKey: fieldKey,
      value: value,
      hlc: _clock,
      idempotencyKey: idempotencyKey,
      isDeleted: isDeleted,
    );

    _pendingQueue.add(mutation);

    // Apply mutation optimistically to local merged state
    final compositeKey = '$entityType:$entityId:$fieldKey';
    _localMergedState[compositeKey] = {
      'value': value,
      'hlc': _clock.packToString(),
      'isDeleted': isDeleted,
    };

    debugPrint('[CrdtSyncEngine] Local mutation recorded: $compositeKey (Pending: ${_pendingQueue.length})');

    // Trigger sync immediately if network is available
    unawaited(flushPendingMutations());

    return mutation;
  }

  /// Flushes pending mutations to the backend CRDT endpoint.
  Future<bool> flushPendingMutations({String? authToken}) async {
    if (_isSyncing || _pendingQueue.isEmpty) return false;
    _isSyncing = true;

    try {
      final batchToSync = List<CrdtMutation>.from(_pendingQueue);
      final payload = {
        'nodeId': _nodeId,
        'clientClock': _clock.packToString(),
        'mutations': batchToSync.map((m) => m.toJson()).toList(),
      };

      final uri = Uri.parse('$_apiBaseUrl/api/sync/crdt/push');
      final headers = {
        'Content-Type': 'application/json',
        if (authToken != null) 'Authorization': 'Bearer $authToken',
      };

      final response = await http
          .post(uri, headers: headers, body: jsonEncode(payload))
          .timeout(const Duration(seconds: 8));

      if (response.statusCode >= 200 && response.statusCode < 300) {
        final resData = jsonDecode(response.body) as Map<String, dynamic>;
        final serverClockStr = resData['serverClock'] as String?;

        if (serverClockStr != null) {
          final serverClock = HybridLogicalClock.unpack(serverClockStr);
          _clock = _clock.receive(serverClock);
        }

        // Remove synced mutations from pending queue
        final syncedIds = batchToSync.map((m) => m.mutationId).toSet();
        _pendingQueue.removeWhere((m) => syncedIds.contains(m.mutationId));

        debugPrint('[CrdtSyncEngine] Synced ${batchToSync.length} mutations successfully.');
        _isSyncing = false;
        return true;
      }
    } catch (e) {
      debugPrint('[CrdtSyncEngine] Sync attempt deferred (network offline): $e');
    }

    _isSyncing = false;
    return false;
  }

  /// Retrieves current local state value for an entity field.
  dynamic getLocalFieldValue(String entityType, String entityId, String fieldKey) {
    final compositeKey = '$entityType:$entityId:$fieldKey';
    return _localMergedState[compositeKey]?['value'];
  }

  void _startPeriodicSync() {
    _autoSyncTimer?.cancel();
    _autoSyncTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_pendingQueue.isNotEmpty) {
        flushPendingMutations();
      }
    });
  }

  void dispose() {
    _autoSyncTimer?.cancel();
  }
}
