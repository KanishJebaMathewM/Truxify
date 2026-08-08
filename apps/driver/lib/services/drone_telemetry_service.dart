import 'dart:async';
import '../models/drone_delivery_model.dart';

class DroneTelemetryService {
  Future<MobileHubState> getHubState() async {
    await Future.delayed(const Duration(milliseconds: 500));
    return MobileHubState(
      hubLocation: 'Safe Launch Zone Alpha - Brooklyn Navy Yard',
      isSafeLaunchZone: true,
      totalDronesAvailable: 4,
      dronesInFlight: 2,
      parcelsRemaining: 8,
    );
  }

  Stream<List<DroneMission>> streamDroneMissions() async* {
    // Initial state
    yield [
      DroneMission(
        droneId: 'DRN-X1',
        parcelId: 'PKG-8821',
        destinationAddress: '145 Williamsburg St',
        distanceKm: 2.4,
        status: 'In Flight',
        batteryPercentage: 82,
        estimatedTimeOfArrivalMins: 4.5,
        hasTelemetryError: false,
      ),
      DroneMission(
        droneId: 'DRN-X2',
        parcelId: 'PKG-3392',
        destinationAddress: '88 Bedford Ave',
        distanceKm: 1.1,
        status: 'Deploying',
        batteryPercentage: 98,
        estimatedTimeOfArrivalMins: 2.0,
        hasTelemetryError: false,
      ),
    ];
    
    await Future.delayed(const Duration(seconds: 3));

    // Update state
    yield [
      DroneMission(
        droneId: 'DRN-X1',
        parcelId: 'PKG-8821',
        destinationAddress: '145 Williamsburg St',
        distanceKm: 0.5,
        status: 'Delivering',
        batteryPercentage: 76,
        estimatedTimeOfArrivalMins: 1.2,
        hasTelemetryError: false,
      ),
      DroneMission(
        droneId: 'DRN-X2',
        parcelId: 'PKG-3392',
        destinationAddress: '88 Bedford Ave',
        distanceKm: 0.8,
        status: 'In Flight',
        batteryPercentage: 95,
        estimatedTimeOfArrivalMins: 1.5,
        hasTelemetryError: false,
      ),
    ];
  }
}
