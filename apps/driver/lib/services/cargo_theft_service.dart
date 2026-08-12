import 'dart:async';
import '../models/cargo_theft_model.dart';

class CargoTheftService {
  final _sessionController = StreamController<CargoTheftSession>.broadcast();

  Stream<CargoTheftSession> get theftStream => _sessionController.stream;

  void simulateParkingSearch() async {
    // 1. Searching
    _sessionController.add(CargoTheftSession(
      driverLocation: 'South Memphis, TN',
      status: 'Scanning Local Parking Options...',
      selectedLocation: null,
      recentTheftsInArea: 0,
      isSafeZone: true,
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Driver attempts to park at a dirt lot (Blackspot)
    _sessionController.add(CargoTheftSession(
      driverLocation: 'South Memphis, TN',
      status: 'CRITICAL: CARGO THEFT BLACKSPOT DETECTED',
      selectedLocation: ParkingLocation(
        locationName: 'Unsecured Dirt Lot (I-55 Exit 7)',
        locationType: 'Unsecured/Abandoned',
        latitude: 35.052,
        longitude: -90.041,
        securityScore: 12,
        hasFencing: false,
        hasGuards: false,
      ),
      recentTheftsInArea: 14, // 14 thefts recently!
      isSafeZone: false,
    ));
    
    await Future.delayed(const Duration(seconds: 5));

    // 3. App forces reroute to a safe truck stop
    _sessionController.add(CargoTheftSession(
      driverLocation: 'South Memphis, TN',
      status: 'REROUTING TO SECURED FACILITY',
      selectedLocation: ParkingLocation(
        locationName: 'Loves Travel Stop (Fenced)',
        locationType: 'Secured Truck Stop',
        latitude: 35.105,
        longitude: -89.920,
        securityScore: 95,
        hasFencing: true,
        hasGuards: true,
      ),
      recentTheftsInArea: 0,
      isSafeZone: true,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
