import '../models/trip_event.dart';

class ConflictResolver {
  List<TripEvent> resolve(List<TripEvent> events) {
    final sorted = List<TripEvent>.of(events)
      ..sort((a, b) => _compareTimestamp(a.occurredAt, b.occurredAt));

    final gpsByTrip = <String, TripEvent>{};
    final otpByStop = <String, TripEvent>{};
    final stopByTripStop = <String, TripEvent>{};
    final lifecycleByTrip = <String, TripEvent>{};
    final routeEvents = <TripEvent>[];
    final podByTrip = <String, TripEvent>{};

    for (final event in sorted) {
      switch (event.type) {
        case 'gpsUpdate':
          final current = gpsByTrip[event.tripId];
          if (current == null || _compareTimestamp(event.occurredAt, current.occurredAt) >= 0) {
            gpsByTrip[event.tripId] = event;
          }
          break;
        case 'otpDelivery':
          final key = '${event.tripId}:${event.payload['stopId']}';
          otpByStop.putIfAbsent(key, () => event);
          break;
        case 'stopArrival':
          final key = '${event.tripId}:${event.payload['stopId']}';
          stopByTripStop.putIfAbsent(key, () => event);
          break;
        case 'podMetadata':
          final key = event.tripId;
          podByTrip[key] = _mergePodMetadata(podByTrip[key], event);
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
    }

    final resolved = <TripEvent>[
      ...gpsByTrip.values,
      ...otpByStop.values,
      ...stopByTripStop.values,
      ...podByTrip.values,
      ...routeEvents,
      ...lifecycleByTrip.values,
    ]
      ..sort((a, b) => _compareTimestamp(a.occurredAt, b.occurredAt));

    return resolved;
  }

  static int _compareTimestamp(String left, String right) {
    final leftTime = DateTime.tryParse(left)?.millisecondsSinceEpoch ?? 0;
    final rightTime = DateTime.tryParse(right)?.millisecondsSinceEpoch ?? 0;
    return leftTime.compareTo(rightTime);
  }

  static Iterable<Map<String, dynamic>> _attachmentRows(Object? value) sync* {
    if (value is! List) return;
    for (final item in value) {
      if (item is Map<String, dynamic>) {
        yield item;
      } else if (item is Map) {
        yield Map<String, dynamic>.from(item);
      }
    }
  }

  static TripEvent _mergePodMetadata(TripEvent? existing, TripEvent incoming) {
    if (existing == null) {
      return incoming;
    }

    final mergedPayload = Map<String, dynamic>.from(existing.payload);
    final incomingPayload = Map<String, dynamic>.from(incoming.payload);

    if (incomingPayload['attachments'] is List && mergedPayload['attachments'] is List) {
      final merged = <Map<String, dynamic>>[];
      final seen = <String>{};
      for (final item in [
        ..._attachmentRows(mergedPayload['attachments']),
        ..._attachmentRows(incomingPayload['attachments']),
      ]) {
        final hash = '${item['name'] ?? ''}:${item['hash'] ?? ''}';
        if (!seen.contains(hash)) {
          seen.add(hash);
          merged.add(item);
        }
      }
      mergedPayload['attachments'] = merged;
    }

    return existing.copyWith(payload: mergedPayload, occurredAt: incoming.occurredAt);
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
