import 'dart:async';
import '../models/yard_trailer_model.dart';

class DroneInventoryService {
  /// Simulates connecting to an automated yard drone API that feeds
  /// real-time barcode scans back into the yard management system.
  Stream<YardTrailer> startDroneYardScan() async* {
    // Wait to simulate the drone taking off and navigating to Zone A
    await Future.delayed(const Duration(seconds: 3));

    yield YardTrailer(
      trailerId: 'TRL-990-AB',
      yardSpot: 'Zone A - Spot 12',
      status: 'LOADED',
      lastScanned: DateTime.now(),
      isVerifiedByDrone: true,
    );

    // Simulate drone flying to Zone B
    await Future.delayed(const Duration(seconds: 4));

    yield YardTrailer(
      trailerId: 'TRL-441-XY',
      yardSpot: 'Zone B - Spot 44',
      status: 'EMPTY',
      lastScanned: DateTime.now(),
      isVerifiedByDrone: true,
    );

    // Simulate finding a mismatched trailer
    await Future.delayed(const Duration(seconds: 4));

    yield YardTrailer(
      trailerId: 'UNKNOWN-BARCODE-331',
      yardSpot: 'Zone C - Spot 19',
      status: 'UNKNOWN',
      lastScanned: DateTime.now(),
      isVerifiedByDrone: true,
    );
  }
}
