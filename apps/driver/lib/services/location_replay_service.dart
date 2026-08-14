import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:truxify_shared/truxify_shared.dart';

import 'offline_location_queue.dart';

/// Current state of the replay worker.
enum LocationReplayState {
  /// No replay pass is running.
  idle,

  /// A replay pass is in flight. `kick()` calls made during this window are
  /// no-ops.
  replaying,
}

/// Single source of truth for delivering items from the offline
/// [OfflineLocationQueue] once the backend becomes reachable.
///
/// Guarantees
/// ----------
/// * **Single worker** — `kick()` is a no-op while another replay is running,
///   so background sync, foreground connect and reconnect can never spawn two
///   competing replay loops.
/// * **At-least-once, exactly-once-removal** — an item is removed only after
///   the backend accepts it. A failed item stays queued for the next reconnect.
/// * **Stops on disconnect** — the loop checks connection health before every
///   item and aborts as soon as the transport drops, leaving the remainder
///   queued.
/// * **Rate-limit aware** — the backend WebSocket limiter allows
///   `MAX_MSG_PER_SECOND` (10) messages per socket per second. [replayDelay]
///   spaces replays far below that budget so the normal 5s live ping cadence
///   is never starved and replayed batches are not silently dropped.
/// * **Idempotent** — milestone items carry a stable `orderId + milestone`
///   identity; replaying the same logical milestone uses the same identity.
class LocationReplayService {
  LocationReplayService._();

  /// Production singleton.
  static final LocationReplayService instance = LocationReplayService._();

  /// Test hook: substitute the queue backing the replay worker.
  @visibleForTesting
  OfflineLocationQueue? queueOverride;

  OfflineLocationQueue get _queue => queueOverride ?? OfflineLocationQueue.instance;

  bool _replaying = false;
  bool _stopRequested = false;

  /// Whether a replay pass is currently running.
  LocationReplayState get state =>
      _replaying ? LocationReplayState.replaying : LocationReplayState.idle;

  /// Transport hooks — installed by [LocationService] when tracking starts.
  ///
  /// * [sendLocation] — hands a `location_ping` data map to the tracking
  ///   WebSocket; returns [WsSendResult.delivered] only when the socket
  ///   accepted it.
  /// * [sendMilestone] — delivers a geofence milestone over HTTP; returns
  ///   `true` when the backend accepted it (2xx or 409 "already completed").
  /// * [tokenProvider] — current auth token for milestone HTTP calls.
  /// * [driverIdProvider] — current authenticated driver id.
  /// * [isConnected] — whether the tracking WebSocket is currently usable.
  WsSendResult Function(Map<String, dynamic> payload)? sendLocation;
  Future<bool> Function({
    required String orderId,
    required String milestone,
    required String token,
  })?
      sendMilestone;
  String? Function()? tokenProvider;
  String? Function()? driverIdProvider;
  bool Function()? isConnected;

  /// Spacing between replayed messages (≈4 msg/s, well under the backend's
  /// 10 msg/s per-socket budget). Mutable so tests can shorten it.
  @visibleForTesting
  static Duration replayDelay = const Duration(milliseconds: 250);

  /// The largest batch replayed in one pass — bounds a single reconnect burst
  /// so hundreds of stale points are never flushed at once. A follow-up
  /// reconnect (or the next live ping path) replays the rest.
  @visibleForTesting
  static const int maxBatchPerRun = 100;

  /// Kicks a replay pass. Safe to call from any trigger (reconnect, app start,
  /// manual retry): concurrent callers simply no-op.
  Future<void> kick() async {
    if (_replaying) return;
    _replaying = true;
    _stopRequested = false;
    try {
      final sendLoc = sendLocation;
      if (sendLoc == null) return;

      final currentDriverId = driverIdProvider?.call();
      final pending = await _queue.pending();

      var sentInBatch = 0;
      for (final item in pending) {
        if (_stopRequested) break;
        if (isConnected?.call() == false) break;
        if (sentInBatch >= maxBatchPerRun) break;

        switch (item.kind) {
          case QueueItemKind.location:
            final payload = Map<String, dynamic>.from(item.payload);
            final data = payload['data'] is Map<String, dynamic>
                ? (payload['data'] as Map<String, dynamic>)
                : payload;
            if (currentDriverId != null &&
                data['driver_id']?.toString() != currentDriverId) {
              // Belongs to a different driver session — never deliver it, but
              // leave it queued (it may become valid again after re-login).
              continue;
            }
            // Freshen the timestamp so the backend's clock-skew gate
            // (±5 min) accepts replayed fixes from an offline stretch.
            final nowIso = DateTime.now().toIso8601String();
            data['device_timestamp'] = nowIso;
            data['timestamp'] = nowIso;
            if (sendLoc(payload) != WsSendResult.delivered) {
              // Transport dropped mid-replay — stop now, keep the rest queued.
              debugPrint('[Replay] Location ${item.id} failed — stopping replay');
              return;
            }
            await _queue.remove(item.id);
            sentInBatch++;
            debugPrint('[Replay] Location ${item.id} delivered');
            break;

          case QueueItemKind.milestone:
            final orderId = item.orderId;
            final milestone = item.milestone;
            final token = tokenProvider?.call();
            final sendMs = sendMilestone;
            if (orderId == null || milestone == null || token == null || sendMs == null) {
              continue;
            }
            final delivered =
                await sendMs(orderId: orderId, milestone: milestone, token: token);
            if (!delivered) {
              // Backend unreachable/unhappy — stop and retry on next reconnect.
              debugPrint('[Replay] Milestone ${item.id} failed — stopping replay');
              return;
            }
            await _queue.remove(item.id);
            sentInBatch++;
            debugPrint('[Replay] Milestone ${item.id} delivered ($orderId / $milestone)');
            break;
        }

        await Future<void>.delayed(replayDelay);
      }
    } finally {
      _replaying = false;
    }
  }

  /// Asks an in-flight replay to stop before the next item.
  ///
  /// Called when tracking stops so a background replay never outlives the
  /// activity that triggered it.
  void requestStop() {
    _stopRequested = true;
  }
}
