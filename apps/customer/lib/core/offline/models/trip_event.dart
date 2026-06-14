import 'dart:convert';

import 'package:uuid/uuid.dart';

class TripEvent {
  TripEvent({
    required this.id,
    required this.tripId,
    required this.type,
    required this.payload,
    required this.occurredAt,
    this.syncStatus = 'pending',
    this.retryCount = 0,
    this.lastRetryAt,
  });

  factory TripEvent.gpsUpdate(
    String tripId,
    Map<String, dynamic> payload, {
    String? id,
    String? occurredAt,
    String syncStatus = 'pending',
    int retryCount = 0,
  }) {
    final normalizedPayload = <String, dynamic>{
      'lat': payload['lat'] ?? payload['latitude'],
      'lng': payload['lng'] ?? payload['longitude'],
      if (payload.containsKey('timestampMs')) 'timestampMs': payload['timestampMs'],
      if (payload.containsKey('timestamp_ms')) 'timestampMs': payload['timestamp_ms'],
    }..removeWhere((key, value) => value == null);

    return TripEvent(
      id: id ?? const Uuid().v4(),
      tripId: tripId,
      type: 'gpsUpdate',
      payload: normalizedPayload,
      occurredAt: occurredAt ?? DateTime.now().toUtc().toIso8601String(),
      syncStatus: syncStatus,
      retryCount: retryCount,
    );
  }

  factory TripEvent.otpDelivery(
    String tripId,
    String stopId, {
    String? id,
    String? occurredAt,
    String syncStatus = 'pending',
    int retryCount = 0,
  }) {
    return TripEvent(
      id: id ?? const Uuid().v4(),
      tripId: tripId,
      type: 'otpDelivery',
      payload: {'stopId': stopId},
      occurredAt: occurredAt ?? DateTime.now().toUtc().toIso8601String(),
      syncStatus: syncStatus,
      retryCount: retryCount,
    );
  }

  factory TripEvent.stopArrival(
    String tripId,
    String stopId, {
    String? id,
    String? occurredAt,
    String syncStatus = 'pending',
    int retryCount = 0,
  }) {
    return TripEvent(
      id: id ?? const Uuid().v4(),
      tripId: tripId,
      type: 'stopArrival',
      payload: {'stopId': stopId},
      occurredAt: occurredAt ?? DateTime.now().toUtc().toIso8601String(),
      syncStatus: syncStatus,
      retryCount: retryCount,
    );
  }

  factory TripEvent.podMetadata(
    String tripId,
    Map<String, dynamic> payload, {
    String? id,
    String? occurredAt,
    String syncStatus = 'pending',
    int retryCount = 0,
  }) {
    return TripEvent(
      id: id ?? const Uuid().v4(),
      tripId: tripId,
      type: 'podMetadata',
      payload: payload,
      occurredAt: occurredAt ?? DateTime.now().toUtc().toIso8601String(),
      syncStatus: syncStatus,
      retryCount: retryCount,
    );
  }

  factory TripEvent.tripStart(
    String tripId, {
    String? id,
    String? occurredAt,
    String syncStatus = 'pending',
    int retryCount = 0,
  }) {
    return TripEvent(
      id: id ?? const Uuid().v4(),
      tripId: tripId,
      type: 'tripStart',
      payload: {'tripId': tripId},
      occurredAt: occurredAt ?? DateTime.now().toUtc().toIso8601String(),
      syncStatus: syncStatus,
      retryCount: retryCount,
    );
  }

  factory TripEvent.tripEnd(
    String tripId, {
    String? id,
    String? occurredAt,
    String syncStatus = 'pending',
    int retryCount = 0,
  }) {
    return TripEvent(
      id: id ?? const Uuid().v4(),
      tripId: tripId,
      type: 'tripEnd',
      payload: {'tripId': tripId},
      occurredAt: occurredAt ?? DateTime.now().toUtc().toIso8601String(),
      syncStatus: syncStatus,
      retryCount: retryCount,
    );
  }

  final String id;
  final String tripId;
  final String type;
  final Map<String, dynamic> payload;
  final String occurredAt;
  final String syncStatus;
  final int retryCount;
  final String? lastRetryAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'trip_id': tripId,
        'type': type,
        'payload': payload,
        'occurred_at': occurredAt,
        'sync_status': syncStatus,
        'retry_count': retryCount,
        'last_retry_at': lastRetryAt,
      };

  static TripEvent fromJson(Map<String, dynamic> json) => TripEvent(
        id: json['id'] as String,
        tripId: json['trip_id'] as String,
        type: json['type'] as String,
        payload: json['payload'] is String
            ? Map<String, dynamic>.from(jsonDecode(json['payload'] as String) as Map)
            : Map<String, dynamic>.from(json['payload'] as Map<dynamic, dynamic>),
        occurredAt: json['occurred_at'] as String,
        syncStatus: json['sync_status'] as String? ?? 'pending',
        retryCount: json['retry_count'] as int? ?? 0,
        lastRetryAt: json['last_retry_at'] as String?,
      );

  TripEvent copyWith({
    String? id,
    String? tripId,
    String? type,
    Map<String, dynamic>? payload,
    String? occurredAt,
    String? syncStatus,
    int? retryCount,
    String? lastRetryAt,
  }) {
    return TripEvent(
      id: id ?? this.id,
      tripId: tripId ?? this.tripId,
      type: type ?? this.type,
      payload: payload ?? this.payload,
      occurredAt: occurredAt ?? this.occurredAt,
      syncStatus: syncStatus ?? this.syncStatus,
      retryCount: retryCount ?? this.retryCount,
      lastRetryAt: lastRetryAt ?? this.lastRetryAt,
    );
  }
}
