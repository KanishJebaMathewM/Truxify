
import 'gps/gps_delta_compressor.dart';
import 'cache/cache_manager.dart';
import 'db/offline_event_db.dart';
import 'models/trip_event.dart';
import 'sync/sync_engine.dart';
import 'websocket/resilient_websocket.dart';

class OfflineSyncManager {
  OfflineSyncManager({
    required this.apiBaseUrl,
    required this.wsUrl,
  });

  final String apiBaseUrl;
  final String wsUrl;

  final OfflineEventDb _db = OfflineEventDb();
  final CacheManager _cacheManager = CacheManager();

  SyncEngine? _syncEngine;
  ResilientWebSocket? _ws;

  bool _initialized = false;
  bool _disposed = false;
  bool _dbOpened = false;
  bool _cacheOpened = false;

  /// Initializes the offline database, cache, sync engine and WebSocket.
  Future<void> init() async {
    if (_disposed) {
      throw StateError('OfflineSyncManager has already been disposed.');
    }

    if (_initialized) return;

    try {
      await _db.open();
      _dbOpened = true;

      // Recover events left in the syncing state after an interrupted upload.
      await _db.reconcileStuckSyncing();

      await _cacheManager.open();
      _cacheOpened = true;

      _syncEngine = SyncEngine(
        db: _db,
        apiBaseUrl: apiBaseUrl,
      );

      await _syncEngine!.startListening();

      _ws = ResilientWebSocket(wsUrl);
      await _ws!.connect();

      _initialized = true;
    } catch (error) {
      await _cleanup();
      rethrow;
    }
  }

  /// Ensures the manager is initialized before performing operations.
  void _checkInitialized() {
    if (!_initialized || _disposed) {
      throw StateError(
        'OfflineSyncManager must be initialized before use.',
      );
    }
  }

  /// Saves an event locally and attempts synchronization.
  Future<void> _saveAndSync(TripEvent event) async {
    _checkInitialized();

    await _db.insert(event);
    await _syncEngine!.syncPending();
  }

  // ---------------- TRIP EVENTS ----------------

  Future<void> recordGpsUpdate({
    required String tripId,
    required GpsPoint point,
  }) async {
    final event = TripEvent.gpsUpdate(
      tripId,
      {
        'lat': point.latitude,
        'lng': point.longitude,
        'timestampMs': point.timestampMs,
      },
    );

    await _saveAndSync(event);
  }

  Future<void> recordOtpDelivery({
    required String tripId,
    required String stopId,
  }) async {
    final event = TripEvent.otpDelivery(tripId, stopId);
    await _saveAndSync(event);
  }

  Future<void> recordTripStart({
    required String tripId,
  }) async {
    final event = TripEvent.tripStart(tripId);
    await _saveAndSync(event);
  }

  Future<void> recordStopArrival({
    required String tripId,
    required String stopId,
  }) async {
    final event = TripEvent.stopArrival(tripId, stopId);
    await _saveAndSync(event);
  }

  Future<void> recordPodMetadata({
    required String tripId,
    required Map<String, dynamic> payload,
  }) async {
    final event = TripEvent.podMetadata(tripId, payload);
    await _saveAndSync(event);
  }

  Future<void> recordTripEnd({
    required String tripId,
  }) async {
    final event = TripEvent.tripEnd(tripId);
    await _saveAndSync(event);
  }

  // ---------------- ORDER CACHE ----------------

  Future<void> cacheOrders(
    List<Map<String, dynamic>> orders,
  ) async {
    _checkInitialized();
    await _cacheManager.cacheOrders(orders);
  }

  Future<List<Map<String, dynamic>>> getCachedOrders({
    bool activeOnly = false,
    int limit = 20,
  }) async {
    _checkInitialized();

    return _cacheManager.getOrders(
      activeOnly: activeOnly,
      limit: limit,
    );
  }

  // ---------------- PROFILE CACHE ----------------

  Future<void> cacheProfile(
    Map<String, dynamic> profile,
  ) async {
    _checkInitialized();
    await _cacheManager.cacheProfile(profile);
  }

  Future<Map<String, dynamic>?> getCachedProfile() async {
    _checkInitialized();
    return _cacheManager.getProfile();
  }

  // ---------------- DOCUMENT CACHE ----------------

  Future<void> cacheDocuments(
    List<Map<String, dynamic>> documents,
  ) async {
    _checkInitialized();
    await _cacheManager.cacheDocuments(documents);
  }

  Future<List<Map<String, dynamic>>> getCachedDocuments() async {
    _checkInitialized();
    return _cacheManager.getDocuments();
  }

  // ---------------- SETTINGS CACHE ----------------

  Future<void> cacheSettings(
    Map<String, dynamic> settings,
  ) async {
    _checkInitialized();
    await _cacheManager.cacheSettings(settings);
  }

  Future<Map<String, dynamic>> getCachedSettings() async {
    _checkInitialized();
    return _cacheManager.getSettings();
  }

  // ---------------- LOCATION CACHE ----------------

  Future<void> cacheLastLocation(
    double latitude,
    double longitude,
  ) async {
    _checkInitialized();
    await _cacheManager.cacheLastLocation(latitude, longitude);
  }

  Future<Map<String, dynamic>?> getCachedLastLocation() async {
    _checkInitialized();
    return _cacheManager.getLastLocation();
  }

  // ---------------- MILESTONE CACHE ----------------

  Future<void> cacheMilestones(
    String orderId,
    List<Map<String, dynamic>> milestones,
  ) async {
    _checkInitialized();
    await _cacheManager.cacheMilestones(orderId, milestones);
  }

  Future<List<Map<String, dynamic>>> getCachedMilestones(
    String orderId,
  ) async {
    _checkInitialized();
    return _cacheManager.getMilestones(orderId);
  }

  // ---------------- CLEANUP ----------------

  Future<void> _cleanup() async {
    _initialized = false;

    final syncEngine = _syncEngine;
    _syncEngine = null;

    if (syncEngine != null) {
      await syncEngine.dispose();
    }

    final websocket = _ws;
    _ws = null;

    if (websocket != null) {
      await websocket.close();
    }

    if (_dbOpened) {
      await _db.close();
      _dbOpened = false;
    }

    if (_cacheOpened) {
      await _cacheManager.close();
      _cacheOpened = false;
    }
  }

  Future<void> dispose() async {
    if (_disposed) return;

    _disposed = true;
    await _cleanup();
  }
}

