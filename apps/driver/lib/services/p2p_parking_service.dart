import 'dart:async';
import '../models/parking_spot_model.dart';

class P2PParkingService {
  Future<List<ParkingSpotHandoff>> findNearbyDepartures() async {
    await Future.delayed(const Duration(seconds: 2));

    return [
      ParkingSpotHandoff(
        locationName: 'Flying J Travel Center - I-80 Exit 201',
        gpsCoordinates: '41.8781° N, 87.6298° W',
        departingDriver: 'John \'Diesel\' Doe',
        expectedDepartureTime: DateTime.now().add(const Duration(minutes: 12)),
        spotType: 'Pull-through',
        hasHookups: true,
        status: 'Available',
      ),
      ParkingSpotHandoff(
        locationName: 'Loves Travel Stop - I-80 Exit 210',
        gpsCoordinates: '41.8821° N, 87.6322° W',
        departingDriver: 'Big Rig Bob',
        expectedDepartureTime: DateTime.now().add(const Duration(minutes: 5)),
        spotType: 'Back-in',
        hasHookups: false,
        status: 'Available',
      ),
    ];
  }

  Future<bool> reserveHandoff(ParkingSpotHandoff spot) async {
    await Future.delayed(const Duration(seconds: 1));
    return true;
  }
}
