import 'dart:async';

import 'package:flutter/foundation.dart';

import 'location_service.dart';

/// Ties the active-trip lifecycle to GPS WebSocket emission.
///
/// Usage:
/// ```dart
/// final gps = GpsTrackingService();
/// await gps.startForTrip(tripDisplayId: 'TRX-1234');
/// // ...on screen dispose or trip completion...
/// await gps.stop();
/// ```
///
/// The service delegates entirely to [LocationService.instance], which already
/// manages WebSocket connection, reconnection and 5-second heartbeats.
class GpsTrackingService {
  GpsTrackingService() : _location = LocationService.instance;

  final LocationService _location;

  StreamSubscription<WsConnectionStatus>? _statusSub;

  /// Whether GPS emission is currently active.
  bool get isTracking => _location.isTracking;

  /// Real-time WebSocket connection status.
  Stream<WsConnectionStatus> get connectionStatus => _location.connectionStatus;

  /// Start emitting GPS updates for the given [tripDisplayId].
  ///
  /// If [tripDisplayId] is provided it is pre-seeded in [LocationService] so
  /// the very first ping already includes the correct order context without
  /// waiting for a Supabase round-trip.
  ///
  /// Safe to call multiple times — subsequent calls are no-ops if already tracking.
  Future<void> startForTrip({required String tripDisplayId}) async {
    if (_location.isTracking) {
      debugPrint('[GpsTrackingService] Already tracking — skipping duplicate start.');
      return;
    }

    debugPrint('[GpsTrackingService] Starting GPS tracking for trip $tripDisplayId');
    await _location.startTracking(tripId: tripDisplayId);
  }

  /// Stop GPS emission and clean up resources.
  ///
  /// Should be called in the dispose() of the screen that started tracking,
  /// or when the trip status transitions to a terminal state (delivered /
  /// cancelled).
  Future<void> stop() async {
    debugPrint('[GpsTrackingService] Stopping GPS tracking.');
    _statusSub?.cancel();
    _statusSub = null;
    _location.stopTracking();
  }
}
