import 'dart:async';
import '../models/blind_spot_ar_model.dart';

class BlindSpotArService {
  final _sessionController = StreamController<BlindSpotSession>.broadcast();

  Stream<BlindSpotSession> get arStream => _sessionController.stream;

  void simulateHighwayDriving() async {
    // 1. Cruising normally
    _sessionController.add(BlindSpotSession(
      status: '360° Surround View Active',
      turnSignalActive: false,
      activeWarningZone: null,
      detectedVehicles: [
        DetectedVehicle(
          vehicleId: 'V1',
          type: 'SUV',
          locationZone: 'Left Passing Lane',
          distanceFeet: 120.0,
          relativeSpeedMph: 5.0,
          isHazard: false,
        )
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Car enters passenger side blind spot
    _sessionController.add(BlindSpotSession(
      status: 'Vehicle Detected in Right Blind Spot',
      turnSignalActive: false,
      activeWarningZone: 'Right',
      detectedVehicles: [
        DetectedVehicle(
          vehicleId: 'V1',
          type: 'SUV',
          locationZone: 'Left Passing Lane',
          distanceFeet: 250.0,
          relativeSpeedMph: 15.0,
          isHazard: false,
        ),
        DetectedVehicle(
          vehicleId: 'V2',
          type: 'Sedan (Compact)',
          locationZone: 'Right Trailer Tandems',
          distanceFeet: 15.0, // Very close
          relativeSpeedMph: 0.0, // Matching speed, lingering in blind spot
          isHazard: true,
        )
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Driver hits right turn signal while car is there -> Critical Warning
    _sessionController.add(BlindSpotSession(
      status: 'CRITICAL COLLISION WARNING - ABORT LANE CHANGE',
      turnSignalActive: true, // Signal is on
      activeWarningZone: 'Right',
      detectedVehicles: [
        DetectedVehicle(
          vehicleId: 'V2',
          type: 'Sedan (Compact)',
          locationZone: 'Right Trailer Tandems',
          distanceFeet: 15.0, 
          relativeSpeedMph: 0.0, 
          isHazard: true, // Now extremely dangerous because turn signal is on
        )
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
