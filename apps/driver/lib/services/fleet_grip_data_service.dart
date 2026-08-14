import 'dart:async';
import '../models/fleet_grip_data_model.dart';

class FleetGripDataService {
  final _meshController = StreamController<FleetGripNetwork>.broadcast();

  Stream<FleetGripNetwork> get meshStream => _meshController.stream;

  void simulateGripMesh() async {
    // 1. Clear Roads initially
    _meshController.add(FleetGripNetwork(
      currentGripIndex: 9.8,
      currentStatus: 'Clear',
      requiresChains: false,
      upcomingReports: [
        GripReport(highwaySegment: 'I-70 West Mile 215', distanceAheadMiles: 5.0, roadGripIndex: 9.5, activeSlipEventsDetected: 0, reportingTrucks: 12, status: 'Clear'),
        GripReport(highwaySegment: 'I-70 West Mile 208 (Vail Pass)', distanceAheadMiles: 12.0, roadGripIndex: 8.0, activeSlipEventsDetected: 2, reportingTrucks: 8, status: 'Slush'),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Approaching Mountain Pass - Grip drops, slips detected by trucks ahead
    _meshController.add(FleetGripNetwork(
      currentGripIndex: 8.0,
      currentStatus: 'Slush',
      requiresChains: false,
      upcomingReports: [
        GripReport(highwaySegment: 'I-70 West Mile 208 (Vail Pass)', distanceAheadMiles: 5.0, roadGripIndex: 8.0, activeSlipEventsDetected: 2, reportingTrucks: 8, status: 'Slush'),
        GripReport(highwaySegment: 'I-70 West Mile 201', distanceAheadMiles: 12.0, roadGripIndex: 2.1, activeSlipEventsDetected: 45, reportingTrucks: 14, status: 'Black Ice'),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 3. Imminent Danger - Chain up required based on catastrophic grip drop ahead
    _meshController.add(FleetGripNetwork(
      currentGripIndex: 7.5,
      currentStatus: 'Light Snow',
      requiresChains: true, // App enforces chain up due to reports ahead
      upcomingReports: [
        GripReport(highwaySegment: 'I-70 West Mile 201 (Approaching)', distanceAheadMiles: 2.0, roadGripIndex: 1.2, activeSlipEventsDetected: 89, reportingTrucks: 22, status: 'Sheer Ice - CHAIN UP REQUIRED'),
        GripReport(highwaySegment: 'I-70 West Mile 195', distanceAheadMiles: 8.0, roadGripIndex: 1.5, activeSlipEventsDetected: 60, reportingTrucks: 18, status: 'Black Ice'),
      ],
    ));
  }

  void dispose() {
    _meshController.close();
  }
}
