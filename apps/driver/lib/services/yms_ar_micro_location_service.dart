import 'dart:async';
import '../models/yms_ar_micro_location_model.dart';

class YmsArMicroLocationService {
  Future<TrailerMicroLocation> locateTrailer(String trailerId) async {
    // Simulate pinging the backend for the exact GPS pin dropped by the last driver
    await Future.delayed(const Duration(seconds: 2));
    
    return TrailerMicroLocation(
      trailerId: trailerId,
      type: "53' Refrigerated",
      exactLocation: YardLocation(
        latitude: 34.0522,
        longitude: -118.2437,
        slotId: 'Row K, Slot 19 (South Yard)',
      ),
      droppedAt: DateTime.now().subtract(const Duration(hours: 14)),
      droppedByDriverId: 'DRV-8821',
    );
  }

  Future<void> dropTrailerPin(String trailerId, String slotId) async {
    // Simulate dropping a high precision pin
    await Future.delayed(const Duration(seconds: 1));
  }
}
