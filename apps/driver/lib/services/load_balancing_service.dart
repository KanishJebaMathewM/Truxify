import 'dart:async';
import '../models/load_balancing_model.dart';

class LoadBalancingService {
  final _sessionController = StreamController<LoadBalancingSession>.broadcast();

  Stream<LoadBalancingSession> get loadStream => _sessionController.stream;

  void simulateLoadingProcess() async {
    // 1. Empty Trailer
    _sessionController.add(LoadBalancingSession(
      status: 'Awaiting Next Pallet...',
      isArActive: false,
      currentSteerWeight: 11000.0, // Base weight
      currentDriveWeight: 15000.0, // Empty tractor
      currentTandemWeight: 9000.0, // Empty trailer
      activeScannedPallet: null,
      loadedPallets: [],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Scanning heavy pallet
    _sessionController.add(LoadBalancingSession(
      status: 'Scanning Barcode...',
      isArActive: false,
      currentSteerWeight: 11000.0,
      currentDriveWeight: 15000.0,
      currentTandemWeight: 9000.0,
      activeScannedPallet: Pallet(
        id: 'PLT-8821',
        weightLbs: 3450.0, // Heavy
        content: 'Machinery Parts',
        isPlaced: false,
        recommendedZone: 'Zone A (Nose)', // Put heavy stuff up front
      ),
      loadedPallets: [],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. AR Active
    _sessionController.add(LoadBalancingSession(
      status: 'PROJECTING 3D PLACEMENT HOLOGRAM',
      isArActive: true,
      currentSteerWeight: 11000.0,
      currentDriveWeight: 15000.0,
      currentTandemWeight: 9000.0,
      activeScannedPallet: Pallet(
        id: 'PLT-8821',
        weightLbs: 3450.0,
        content: 'Machinery Parts',
        isPlaced: false,
        recommendedZone: 'Zone A (Nose)',
      ),
      loadedPallets: [],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 4. Placed
    _sessionController.add(LoadBalancingSession(
      status: 'Pallet Secured. Axles Balanced.',
      isArActive: false,
      currentSteerWeight: 11200.0,
      currentDriveWeight: 18000.0, // Shifted weight to drives
      currentTandemWeight: 9250.0, 
      activeScannedPallet: null,
      loadedPallets: [
        Pallet(
          id: 'PLT-8821',
          weightLbs: 3450.0,
          content: 'Machinery Parts',
          isPlaced: true,
          recommendedZone: 'Zone A (Nose)',
        )
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
