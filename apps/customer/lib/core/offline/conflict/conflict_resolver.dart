import '../models/trip_event.dart';

class ConflictResolutionResult {
  final List<TripEvent> resolved;
  final List<String> supersededIds;

  ConflictResolutionResult({
    required this.resolved,
    required this.supersededIds,
  });
}

class ConflictResolver {
  ConflictResolutionResult resolveWithDetails(List<TripEvent> events) {
    try {
      final resolved = resolve(events);
      final resolvedIds = resolved.map((e) => e.id).toSet();
      final supersededIds = events
          .map((e) => e.id)
          .where((id) => !resolvedIds.contains(id))
          .toList();

      return ConflictResolutionResult(
        resolved: resolved,
        supersededIds: supersededIds,
      );
    } catch (err, stack) {
      print('[ConflictResolver Error] Failed in resolveWithDetails: $err\n$stack');
      return ConflictResolutionResult(resolved: events, supersededIds: []);
    }
  }

  List<TripEvent> resolve(List<TripEvent> events) {
    try {
      final sorted = List<TripEvent>.of(events)
        ..sort((a, b) => _compareTimestamp(a.occurredAt, b.occurredAt));

      final gpsEvents = <TripEvent>[];
      final otpByStop = <String, TripEvent>{};
      final stopByTripStop = <String, TripEvent>{};
      final lifecycleByTrip = <String, TripEvent>{};
      final routeEvents = <TripEvent>[];
      final podByTrip = <String, TripEvent>{};

      for (final event in sorted) {
        try {
          switch (event.type) {
            case 'gpsUpdate':
              gpsEvents.add(event);
              break;
            case 'otpDelivery':
              {
                final key = '${event.tripId}:${event.payload['stopId']}';
                final current = otpByStop[key];
                if (current == null || _compareTimestamp(event.occurredAt, current.occurredAt) >= 0) {
                  otpByStop[key] = event;
                }
              }
              break;
            case 'stopArrival':
              {
                final key = '${event.tripId}:${event.payload['stopId']}';
                final current = stopByTripStop[key];
                if (current == null || _compareTimestamp(event.occurredAt, current.occurredAt) >= 0) {
                  stopByTripStop[key] = event;
                }
              }
              break;
            case 'podMetadata':
              {
                final key = event.tripId;
                podByTrip[key] = _mergePodMetadata(podByTrip[key], event);
              }
              break;
            case 'routeDeviation':
              routeEvents.add(event);
              break;
            case 'tripStart':
            case 'tripEnd':
              {
                final key = '${event.tripId}:${event.type}';
                lifecycleByTrip.putIfAbsent(key, () => event);
              }
              break;
            default:
              routeEvents.add(event);
              break;
          }
        } catch (eventErr) {
          routeEvents.add(event);
        }
      }

      final resolved = <TripEvent>[
        ...gpsEvents,
        ...otpByStop.values,
        ...stopByTripStop.values,
        ...podByTrip.values,
        ...routeEvents,
        ...lifecycleByTrip.values,
      ]
        ..sort((a, b) => _compareTimestamp(a.occurredAt, b.occurredAt));

      return resolved;
    } catch (e) {
      return events;
    }
  }

  static int _compareTimestamp(String left, String right) {
    try {
      final leftTime = DateTime.tryParse(left)?.millisecondsSinceEpoch ?? 0;
      final rightTime = DateTime.tryParse(right)?.millisecondsSinceEpoch ?? 0;
      return leftTime.compareTo(rightTime);
    } catch (_) {
      return 0;
    }
  }

  static Iterable<Map<String, dynamic>> _attachmentRows(Object? value) sync* {
    if (value is! List) return;
    for (final item in value) {
      try {
        if (item is Map<String, dynamic>) {
          yield item;
        } else if (item is Map) {
          yield Map<String, dynamic>.from(item);
        }
      } catch (_) {}
    }
  }

  static TripEvent _mergePodMetadata(TripEvent? existing, TripEvent incoming) {
    if (existing == null) {
      return incoming;
    }

    try {
      final mergedPayload = Map<String, dynamic>.from(existing.payload);
      final incomingPayload = Map<String, dynamic>.from(incoming.payload);

      if (incomingPayload['attachments'] is List && mergedPayload['attachments'] is List) {
        final merged = <Map<String, dynamic>>[];
        final seen = <String>{};
        for (final item in [
          ..._attachmentRows(mergedPayload['attachments']),
          ..._attachmentRows(incomingPayload['attachments']),
        ]) {
          if (item is! Map<String, dynamic>) continue;
          final hash = '${item['name'] ?? ''}:${item['hash'] ?? ''}';
          if (!seen.contains(hash)) {
            seen.add(hash);
            merged.add(item);
          }
        }
        mergedPayload['attachments'] = merged;
      }

      return existing.copyWith(payload: mergedPayload, occurredAt: incoming.occurredAt);
    } catch (_) {
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

  static ResolutionStrategy fromName(String n) => [latestWins, earliestWins, serverWins, clientWins].firstWhere((s) => s.name == n, orElse: () => latestWins);

  static final List<ResolutionStrategy> values = [latestWins, earliestWins, serverWins, clientWins];
}