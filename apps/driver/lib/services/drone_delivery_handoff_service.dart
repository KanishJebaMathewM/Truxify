import 'dart:async';
import '../models/drone_delivery_handoff_model.dart';

class DroneDeliveryHandoffService {
  final _missionController = StreamController<DroneMission>.broadcast();

  Stream<DroneMission> get missionStream => _missionController.stream;

  void simulateDeliveryMission() async {
    // 1. Ready
    _missionController.add(DroneMission(
      missionId: 'MSN-D991',
      droneId: 'TRX-Air-Alpha',
      deliveryAddress: '123 Residential Ct, Suburbia',
      recipientName: 'Alice Johnson',
      distanceMiles: 4.2,
      payloadWeightLbs: 8.5,
      status: 'Ready to Launch',
      estimatedMinutes: 12,
      batteryPercentage: 100.0,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. In Transit
    _missionController.add(DroneMission(
      missionId: 'MSN-D991',
      droneId: 'TRX-Air-Alpha',
      deliveryAddress: '123 Residential Ct, Suburbia',
      recipientName: 'Alice Johnson',
      distanceMiles: 2.1,
      payloadWeightLbs: 8.5,
      status: 'In Transit (Outbound)',
      estimatedMinutes: 6,
      batteryPercentage: 88.0,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 3. Delivered
    _missionController.add(DroneMission(
      missionId: 'MSN-D991',
      droneId: 'TRX-Air-Alpha',
      deliveryAddress: '123 Residential Ct, Suburbia',
      recipientName: 'Alice Johnson',
      distanceMiles: 0.0,
      payloadWeightLbs: 0.0, // Dropped off
      status: 'Package Delivered',
      estimatedMinutes: 0,
      batteryPercentage: 75.0,
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 4. Returning to Truck
    _missionController.add(DroneMission(
      missionId: 'MSN-D991',
      droneId: 'TRX-Air-Alpha',
      deliveryAddress: 'Returning to Truck Roof',
      recipientName: 'Auto-Docking',
      distanceMiles: 4.2,
      payloadWeightLbs: 0.0,
      status: 'Returning',
      estimatedMinutes: 11,
      batteryPercentage: 74.0,
    ));
  }
  
  void dispose() {
    _missionController.close();
  }
}
