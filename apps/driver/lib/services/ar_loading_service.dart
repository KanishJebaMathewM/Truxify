import 'dart:async';
import '../models/ar_loading_model.dart';

class ArLoadingService {
  final _sessionController = StreamController<ArLoadingSession>.broadcast();

  Stream<ArLoadingSession> get loadingStream => _sessionController.stream;

  void simulateLoading() async {
    // 1. Mapping
    _sessionController.add(ArLoadingSession(
      status: 'LiDAR Mapping 53ft Trailer...',
      totalPallets: 30,
      placedPallets: 0,
      steerAxleLbs: 11000.0, // Empty truck base weight
      driveAxleLbs: 15000.0,
      tandemAxleLbs: 10000.0,
      activePallet: null,
      completedPallets: [],
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Projecting first pallet
    _sessionController.add(ArLoadingSession(
      status: 'AR Projection Active - Follow Hologram',
      totalPallets: 30,
      placedPallets: 0,
      steerAxleLbs: 11000.0,
      driveAxleLbs: 15000.0,
      tandemAxleLbs: 10000.0,
      activePallet: PalletDirective(
        palletId: 'PLT-889-HEAVY',
        dimensions: '48" x 40" x 60"',
        weightLbs: 2200,
        placementZone: 'Nose - Left Wall',
        isPlaced: false,
      ),
      completedPallets: [],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Pallet Placed, balancing axles
    _sessionController.add(ArLoadingSession(
      status: 'AR Projection Active - Follow Hologram',
      totalPallets: 30,
      placedPallets: 1,
      steerAxleLbs: 11300.0, // Weight shifting forward
      driveAxleLbs: 16900.0,
      tandemAxleLbs: 10000.0,
      activePallet: PalletDirective(
        palletId: 'PLT-890-HEAVY',
        dimensions: '48" x 40" x 60"',
        weightLbs: 2150,
        placementZone: 'Nose - Right Wall',
        isPlaced: false,
      ),
      completedPallets: [
        PalletDirective(
          palletId: 'PLT-889-HEAVY',
          dimensions: '48" x 40" x 60"',
          weightLbs: 2200,
          placementZone: 'Nose - Left Wall',
          isPlaced: true,
        )
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
