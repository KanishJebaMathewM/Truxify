import 'dart:convert';
import 'dart:math';

/// Hybrid Logical Clock (HLC) for monotonic causal ordering in distributed systems.
/// Combines physical epoch timestamp (milliseconds), logical counter, and unique node ID.
class HybridLogicalClock implements Comparable<HybridLogicalClock> {
  final int millis;
  final int counter;
  final String nodeId;

  const HybridLogicalClock({
    required this.millis,
    required this.counter,
    required this.nodeId,
  });

  /// Initializes clock from current physical epoch time.
  factory HybridLogicalClock.now(String nodeId) {
    return HybridLogicalClock(
      millis: DateTime.now().millisecondsSinceEpoch,
      counter: 0,
      nodeId: nodeId,
    );
  }

  /// Advances the clock upon a local mutation event.
  HybridLogicalClock send() {
    final physicalNow = DateTime.now().millisecondsSinceEpoch;
    if (physicalNow > millis) {
      return HybridLogicalClock(millis: physicalNow, counter: 0, nodeId: nodeId);
    } else {
      return HybridLogicalClock(millis: millis, counter: counter + 1, nodeId: nodeId);
    }
  }

  /// Advances clock upon receiving a remote message/state clock.
  HybridLogicalClock receive(HybridLogicalClock remote) {
    final physicalNow = DateTime.now().millisecondsSinceEpoch;
    final maxMillis = max(max(millis, remote.millis), physicalNow);

    int nextCounter = 0;
    if (maxMillis == millis && maxMillis == remote.millis) {
      nextCounter = max(counter, remote.counter) + 1;
    } else if (maxMillis == millis) {
      nextCounter = counter + 1;
    } else if (maxMillis == remote.millis) {
      nextCounter = remote.counter + 1;
    } else {
      nextCounter = 0;
    }

    return HybridLogicalClock(millis: maxMillis, counter: nextCounter, nodeId: nodeId);
  }

  /// Serializes HLC to canonical string: `<millis>:<counter>:<nodeId>`.
  String packToString() => '$millis:$counter:$nodeId';

  /// Deserializes HLC from string.
  factory HybridLogicalClock.unpack(String packed) {
    final parts = packed.split(':');
    if (parts.length < 3) {
      return HybridLogicalClock(
        millis: DateTime.now().millisecondsSinceEpoch,
        counter: 0,
        nodeId: 'unknown',
      );
    }
    return HybridLogicalClock(
      millis: int.tryParse(parts[0]) ?? 0,
      counter: int.tryParse(parts[1]) ?? 0,
      nodeId: parts.sublist(2).join(':'),
    );
  }

  @override
  int compareTo(HybridLogicalClock other) {
    if (millis != other.millis) return millis.compareTo(other.millis);
    if (counter != other.counter) return counter.compareTo(other.counter);
    return nodeId.compareTo(other.nodeId);
  }

  @override
  String toString() => packToString();

  Map<String, dynamic> toJson() => {
        'millis': millis,
        'counter': counter,
        'nodeId': nodeId,
        'packed': packToString(),
      };
}

/// Represents an atomic state mutation delta in the CRDT event log.
class CrdtMutation {
  final String mutationId;
  final String entityType; // e.g. 'trip_milestone', 'driver_expense', 'gps_breadcrumb'
  final String entityId;
  final String fieldKey;
  final dynamic value;
  final HybridLogicalClock hlc;
  final String idempotencyKey;
  final bool isDeleted;
  final DateTime createdAt;

  CrdtMutation({
    required this.mutationId,
    required this.entityType,
    required this.entityId,
    required this.fieldKey,
    required this.value,
    required this.hlc,
    required this.idempotencyKey,
    this.isDeleted = false,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  Map<String, dynamic> toJson() => {
        'mutationId': mutationId,
        'entityType': entityType,
        'entityId': entityId,
        'fieldKey': fieldKey,
        'value': value,
        'hlc': hlc.packToString(),
        'idempotencyKey': idempotencyKey,
        'isDeleted': isDeleted,
        'createdAt': createdAt.toIso8601String(),
      };

  factory CrdtMutation.fromJson(Map<String, dynamic> json) {
    return CrdtMutation(
      mutationId: json['mutationId'] as String? ?? '',
      entityType: json['entityType'] as String? ?? 'general',
      entityId: json['entityId'] as String? ?? '',
      fieldKey: json['fieldKey'] as String? ?? '',
      value: json['value'],
      hlc: HybridLogicalClock.unpack(json['hlc'] as String? ?? ''),
      idempotencyKey: json['idempotencyKey'] as String? ?? '',
      isDeleted: json['isDeleted'] as bool? ?? false,
      createdAt: json['createdAt'] != null
          ? DateTime.tryParse(json['createdAt'] as String) ?? DateTime.now()
          : DateTime.now(),
    );
  }
}
