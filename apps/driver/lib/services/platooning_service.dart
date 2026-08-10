import 'dart:async';
import '../models/platooning_model.dart';

class PlatooningService {
  final _sessionController = StreamController<PlatoonSession>.broadcast();

  Stream<PlatoonSession> get platoonStream => _sessionController.stream;

  void simulatePlatooning() async {
    // 1. Pairing
    _sessionController.add(PlatoonSession(
      platoonId: 'PLT-8821',
      status: 'Pairing (V2V Handshake)',
      targetSpeedMph: 65.0,
      optimalGapFeet: 50.0,
      totalFuelSavedGallons: 0.0,
      totalFinancialSavings: 0.0,
      members: [
        PlatoonMember(truckId: 'TRX-LEAD (You)', driverName: 'Mohith Reddy', role: 'Lead Truck', currentSpeedMph: 65.0, followDistanceFeet: 0.0, fuelSavingsPct: 0.0),
        PlatoonMember(truckId: 'TRX-FLW', driverName: 'Sarah Miller', role: 'Follower', currentSpeedMph: 67.0, followDistanceFeet: 120.0, fuelSavingsPct: 0.0),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Active Platooning
    _sessionController.add(PlatoonSession(
      platoonId: 'PLT-8821',
      status: 'Active Platooning',
      targetSpeedMph: 65.0,
      optimalGapFeet: 50.0,
      totalFuelSavedGallons: 2.4,
      totalFinancialSavings: 9.60,
      members: [
        PlatoonMember(truckId: 'TRX-LEAD (You)', driverName: 'Mohith Reddy', role: 'Lead Truck', currentSpeedMph: 65.0, followDistanceFeet: 0.0, fuelSavingsPct: 4.5), // Lead saves some
        PlatoonMember(truckId: 'TRX-FLW', driverName: 'Sarah Miller', role: 'Follower', currentSpeedMph: 65.0, followDistanceFeet: 52.0, fuelSavingsPct: 10.2), // Follower saves more
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Updated stats
    _sessionController.add(PlatoonSession(
      platoonId: 'PLT-8821',
      status: 'Active Platooning',
      targetSpeedMph: 65.0,
      optimalGapFeet: 50.0,
      totalFuelSavedGallons: 4.8,
      totalFinancialSavings: 19.20,
      members: [
        PlatoonMember(truckId: 'TRX-LEAD (You)', driverName: 'Mohith Reddy', role: 'Lead Truck', currentSpeedMph: 65.0, followDistanceFeet: 0.0, fuelSavingsPct: 4.6),
        PlatoonMember(truckId: 'TRX-FLW', driverName: 'Sarah Miller', role: 'Follower', currentSpeedMph: 65.0, followDistanceFeet: 49.5, fuelSavingsPct: 10.4),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
