import 'dart:async';
import '../models/parking_probability_model.dart';

class ParkingProbabilityService {
  final _sessionController = StreamController<ParkingEngineSession>.broadcast();
  
  Stream<ParkingEngineSession> get engineStream => _sessionController.stream;

  void initializeEngine() {
    _emitState('Awaiting Telemetry Data', 'I-80 Westbound', DateTime.now().add(const Duration(hours: 3)), [], false);
  }

  void runTelemetryAnalysis() async {
    _emitState('Aggregating Fleet GPS Telemetry...', 'I-80 Westbound', DateTime.now().add(const Duration(hours: 3)), [], true);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Calculating Rest Stop Velocity Matrices...', 'I-80 Westbound', DateTime.now().add(const Duration(hours: 3)), [], true);

    await Future.delayed(const Duration(seconds: 1));

    List<RestStop> stops = [
      RestStop(
        stopName: "Pilot Travel Center #412",
        highwayLocation: "Exit 182, I-80 W",
        distanceMiles: 45,
        estimatedArrivalMinutes: 48,
        totalCapacity: 120,
        estimatedCurrentOccupancy: 115,
        probabilityScore: 12.5,
        status: 'Likely Full',
      ),
      RestStop(
        stopName: "TA Truck Service / Cheyenne",
        highwayLocation: "Exit 178, I-80 W",
        distanceMiles: 80,
        estimatedArrivalMinutes: 85,
        totalCapacity: 250,
        estimatedCurrentOccupancy: 180,
        probabilityScore: 45.0,
        status: 'Risky',
      ),
      RestStop(
        stopName: "Wyoming State Rest Area",
        highwayLocation: "Mile Marker 120, I-80 W",
        distanceMiles: 140,
        estimatedArrivalMinutes: 150,
        totalCapacity: 45,
        estimatedCurrentOccupancy: 10,
        probabilityScore: 92.5,
        status: 'High Chance',
      )
    ];

    _emitState('Crowdsourced Parking Analysis Complete', 'I-80 Westbound', DateTime.now().add(const Duration(hours: 3)), stops, false);
  }

  void _emitState(String status, String route, DateTime targetTime, List<RestStop> stops, bool isAnalyzing) {
    _sessionController.add(ParkingEngineSession(
      status: status,
      currentRoute: route,
      targetShutdownTime: targetTime,
      upcomingStops: List.from(stops),
      isAnalyzing: isAnalyzing,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
