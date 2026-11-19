
import 'package:flutter/foundation.dart';

import '../models/trip_event.dart';

class ConflictResolutionResult {
  final List<TripEvent> resolved;
  final List<String> supersededIds;

  const ConflictResolutionResult({
    required this.resolved,
    required this.supersededIds,
  });
}

class ConflictResolver {
  ConflictResolutionResult resolveWithDetails(List<TripEvent> events) {
    try {
      final resolved = resolve(events);
      final resolvedIds = resolved.map((event) => event.id).toSet();

      final supersededIds = events
          .where((event) => !resolvedIds.contains(event.id))
          .map((event) => event.id)
          .toSet()
          .toList();

      return ConflictResolutionResult(
        resolved: resolved,
        supersededIds: supersededIds,
      );
    } catch (error, stackTrace) {
      debugPrint(
        '[ConflictResolver] resolveWithDetails failed: $error\n$stackTrace',
      );

      return ConflictResolutionResult(
        resolved: List<TripEvent>.of(events),
        supersededIds: const [],
      );
    }
  }

  List<TripEvent> resolve(List<TripEvent> events) {
    try {
      final sorted = List<TripEvent>.of(events)
        ..sort(
          (a, b) => _compareTimestamp(a.occurredAt, b.occurredAt),
        );

      final gpsByTrip = <String, TripEvent>{};
      final otpByStop = <String, TripEvent>{};
      final stopByTripStop = <String, TripEvent>{};
      final lifecycleByTrip = <String, TripEvent>{};
      final podByTrip = <String, TripEvent>{};
      final routeEvents = <TripEvent>[];

      for (final event in sorted) {
        try {
          switch (event.type) {
            case 'gpsUpdate':
              _keepLatest(gpsByTrip, event.tripId, event);
              break;

            case 'otpDelivery':
              final key = _stopKey(event);
              _keepLatest(otpByStop, key, event);
              break;

            case 'stopArrival':
              final key = _stopKey(event);
              _keepLatest(stopByTripStop, key, event);
              break;

            case 'podMetadata':
              podByTrip[event.tripId] = _mergePodMetadata(
                podByTrip[event.tripId],
                event,
              );
              break;

            case 'routeDeviation':
              routeEvents.add(event);
              break;

            case 'tripStart':
            case 'tripEnd':
              final key = '${event.tripId}:${event.type}';
              lifecycleByTrip.putIfAbsent(key, () => event);
              break;

            default:
              routeEvents.add(event);
              break;
          }
        } catch (error, stackTrace) {
          debugPrint(
            '[ConflictResolver] Failed to process event ${event.id}: '
            '$error\n$stackTrace',
          );

          routeEvents.add(event);
        }
      }

      final resolved = <TripEvent>[
        ...gpsByTrip.values,
        ...otpByStop.values,
        ...stopByTripStop.values,
        ...podByTrip.values,
        ...routeEvents,
        ...lifecycleByTrip.values,
      ]..sort(
          (a, b) => _compareTimestamp(a.occurredAt, b.occurredAt),
        );

      return resolved;
    } catch (error, stackTrace) {
      debugPrint(
        '[ConflictResolver] Resolution failed: $error\n$stackTrace',
      );
      return List<TripEvent>.of(events);
    }
  }

  static String _stopKey(TripEvent event) {
    final stopId = event.payload['stopId']?.toString().trim();

    if (stopId == null || stopId.isEmpty) {
      return '${event.tripId}:unknown:${event.id}';
    }

    return '${event.tripId}:$stopId';
  }

  static void _keepLatest(
    Map<String, TripEvent> target,
    String key,
    TripEvent incoming,
  ) {
    final current = target[key];

    if (current == null ||
        _compareTimestamp(
              incoming.occurredAt,
              current.occurredAt,
            ) >=
            0) {
      target[key] = incoming;
    }
  }

  static int _compareTimestamp(String left, String right) {
    final leftTime = DateTime.tryParse(left);
    final rightTime = DateTime.tryParse(right);

    if (leftTime == null && rightTime == null) return 0;
    if (leftTime == null) return -1;
    if (rightTime == null) return 1;

    return leftTime.compareTo(rightTime);
  }

  static Iterable<Map<String, dynamic>> _attachmentRows(
    Object? value,
  ) sync* {
    if (value is! List) return;

    for (final item in value) {
      try {
        if (item is Map<String, dynamic>) {
          yield item;
        } else if (item is Map) {
          yield Map<String, dynamic>.from(item);
        }
      } catch (error) {
        debugPrint(
          '[ConflictResolver] Dropped malformed attachment: $error',
        );
      }
    }
  }

  static TripEvent _mergePodMetadata(
    TripEvent? existing,
    TripEvent incoming,
  ) {
    if (existing == null) return incoming;

    try {
      final mergedPayload = Map<String, dynamic>.from(existing.payload);
      final incomingPayload = Map<String, dynamic>.from(incoming.payload);

      final attachments = <Map<String, dynamic>>[];
      final seen = <String>{};

      for (final item in [
        ..._attachmentRows(mergedPayload['attachments']),
        ..._attachmentRows(incomingPayload['attachments']),
      ]) {
        final hash = '${item['name'] ?? ''}:${item['hash'] ?? ''}';

        if (seen.add(hash)) {
          attachments.add(item);
        }
      }

      if (mergedPayload.containsKey('attachments') ||
          incomingPayload.containsKey('attachments')) {
        mergedPayload['attachments'] = attachments;
      }

      // Preserve the latest metadata fields while retaining attachments.
      mergedPayload.addAll(incomingPayload);
      mergedPayload['attachments'] = attachments;

      return existing.copyWith(
        payload: mergedPayload,
        occurredAt: incoming.occurredAt,
      );
    } catch (error, stackTrace) {
      debugPrint(
        '[ConflictResolver] POD metadata merge failed: '
        '$error\n$stackTrace',
      );
      return incoming;
    }
  }
}

class ResolutionStrategy {
  final String name;
  final int priority;

  const ResolutionStrategy(this.name, this.priority);

  static const latestWins = ResolutionStrategy('latestWins', 1);
  static const earliestWins = ResolutionStrategy('earliestWins', 2);
  static const serverWins = ResolutionStrategy('serverWins', 3);
  static const clientWins = ResolutionStrategy('clientWins', 4);

  static const List<ResolutionStrategy> values = [
    latestWins,
    earliestWins,
    serverWins,
    clientWins,
  ];

  static ResolutionStrategy fromName(String name) {
    return values.firstWhere(
      (strategy) => strategy.name == name,
      orElse: () => latestWins,
    );
  }
}
