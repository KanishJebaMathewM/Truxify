import 'package:truxify/core/offline/gps/gps_delta_compressor.dart';

import 'cache/cache_manager.dart';
import 'db/offline_event_db.dart';
import 'models/trip_event.dart';
import 'sync/sync_engine.dart';
import 'websocket/resilient_websocket.dart';

class OfflineSyncManager {
  OfflineSyncManager({required this.apiBaseUrl, required this.wsUrl});

  final String apiBaseUrl;
  final String wsUrl;

  final OfflineEventDb _db = OfflineEventDb();
  final CacheManager _cacheManager = CacheManager();
  late final SyncEngine _syncEngine;
  late final ResilientWebSocket _ws;

  Future<void> init() async {
    await _db.open();
    await _cacheManager.open();
    _syncEngine = SyncEngine(db: _db, apiBaseUrl: apiBaseUrl);
    await _syncEngine.startListening();
    _ws = ResilientWebSocket(wsUrl);
    await _ws.connect();
  }

  Future<void> recordGpsUpdate({required String tripId, required GpsPoint point}) async {
    final event = TripEvent.gpsUpdate(
      tripId,
      {'lat': point.latitude, 'lng': point.longitude, 'timestampMs': point.timestampMs},
    );
    await _db.insert(event);
    await _syncEngine.syncPending();
  }

  Future<void> recordOtpDelivery({required String tripId, required String stopId, required String otp}) async {
    final event = TripEvent.otpDelivery(tripId, stopId, otp);
    await _db.insert(event);
    await _syncEngine.syncPending();
  }

  Future<void> recordTripStart({required String tripId}) async {
    final event = TripEvent.tripStart(tripId);
    await _db.insert(event);
    await _syncEngine.syncPending();
  }

  Future<void> recordStopArrival({required String tripId, required String stopId}) async {
    final event = TripEvent.stopArrival(tripId, stopId);
    await _db.insert(event);
    await _syncEngine.syncPending();
  }

  Future<void> recordPodMetadata({required String tripId, required Map<String, dynamic> payload}) async {
    final event = TripEvent.podMetadata(tripId, payload);
    await _db.insert(event);
    await _syncEngine.syncPending();
  }

  Future<void> recordTripEnd({required String tripId}) async {
    final event = TripEvent.tripEnd(tripId);
    await _db.insert(event);
    await _syncEngine.syncPending();
  }

  Future<void> cacheOrders(List<Map<String, dynamic>> orders) => _cacheManager.cacheOrders(orders);

  Future<List<Map<String, dynamic>>> getCachedOrders({bool activeOnly = false, int limit = 20}) =>
      _cacheManager.getOrders(activeOnly: activeOnly, limit: limit);

  Future<void> cacheProfile(Map<String, dynamic> profile) => _cacheManager.cacheProfile(profile);

  Future<Map<String, dynamic>?> getCachedProfile() => _cacheManager.getProfile();

  Future<void> cacheDocuments(List<Map<String, dynamic>> documents) => _cacheManager.cacheDocuments(documents);

  Future<List<Map<String, dynamic>>> getCachedDocuments() => _cacheManager.getDocuments();

  Future<void> cacheSettings(Map<String, dynamic> settings) => _cacheManager.cacheSettings(settings);

  Future<Map<String, dynamic>> getCachedSettings() => _cacheManager.getSettings();

  Future<void> cacheLastLocation(double latitude, double longitude) =>
      _cacheManager.cacheLastLocation(latitude, longitude);

  Future<Map<String, dynamic>?> getCachedLastLocation() => _cacheManager.getLastLocation();

  Future<void> cacheMilestones(String orderId, List<Map<String, dynamic>> milestones) =>
      _cacheManager.cacheMilestones(orderId, milestones);

  Future<List<Map<String, dynamic>>> getCachedMilestones(String orderId) =>
      _cacheManager.getMilestones(orderId);

  Future<void> dispose() async {
    await _syncEngine.stopListening();
    await _ws.close();
    await _db.close();
    await _cacheManager.close();
  }
}
