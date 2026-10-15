// apps/customer/lib/services/offline_location_queue.dart

import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class LocationPing {
  final double latitude;
  final double longitude;
  final int timestamp;
  final int sequenceNumber;

  LocationPing({
    required this.latitude,
    required this.longitude,
    required this.timestamp,
    required this.sequenceNumber,
  });

  Map<String, dynamic> toJson() => {
    'latitude': latitude,
    'longitude': longitude,
    'timestamp': timestamp,
    'sequenceNumber': sequenceNumber,
  };

  factory LocationPing.fromJson(Map<String, dynamic> json) => LocationPing(
    latitude: json['latitude'],
    longitude: json['longitude'],
    timestamp: json['timestamp'],
    sequenceNumber: json['sequenceNumber'],
  );
}

class OfflineLocationQueue {
  static const String _storageKey = 'offline_location_buffer_v1';

  // Buffer location locally during network interruptions
  static Future<void> bufferPing(LocationPing ping) async {
    final prefs = await SharedPreferences.getInstance();
    final List<String> rawQueue = prefs.getStringList(_storageKey) ?? [];
    
    rawQueue.add(jsonEncode(ping.toJson()));
    
    // Cap buffer size to prevent memory bloat (max 500 pings)
    if (rawQueue.length > 500) {
      rawQueue.removeAt(0);
    }
    
    await prefs.setStringList(_storageKey, rawQueue);
    debugPrint('Buffered location offline. Total buffered: ${rawQueue.length}');
  }

  // Retrieve and clear buffered queue upon reconnection
  static Future<List<LocationPing>> flushQueue() async {
    final prefs = await SharedPreferences.getInstance();
    final List<String> rawQueue = prefs.getStringList(_storageKey) ?? [];
    
    if (rawQueue.isEmpty) return [];

    List<LocationPing> pings = rawQueue
        .map((str) => LocationPing.fromJson(jsonDecode(str)))
        .toList();

    // Sort chronologically by sequence number
    pings.sort((a, b) => a.sequenceNumber.compareTo(b.sequenceNumber));

    await prefs.remove(_storageKey);
    return pings;
  }
}
