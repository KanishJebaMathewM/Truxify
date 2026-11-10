import 'dart:async';
import '../models/ar_loading_model.dart';
import '../models/ar_cargo_model.dart';

class ArLoadingService {
  final _sessionController = StreamController<ArLoadingSession>.broadcast();

  Stream<ArLoadingSession> get loadingStream => _sessionController.stream;

  /// Simulates fetching the optimal pallet load plan for the trailer.
  Future<List<ArPallet>> getLoadPlan() async {
    await Future.delayed(const Duration(seconds: 1));
    return [
      ArPallet(
        palletId: 'PAL-101',
        destination: 'Dock 4 - New York',
        weightLbs: 1200,
        isFragile: false,
        suggestedPosition: 'Row 1, Left (Nose)',
        colorCode: '#4CAF50',
        isPlaced: false,
      ),
      ArPallet(
        palletId: 'PAL-102',
        destination: 'Dock 7 - Newark',
        weightLbs: 950,
        isFragile: true,
        suggestedPosition: 'Row 1, Right (Nose)',
        colorCode: '#FF9800',
        isPlaced: false,
      ),
      ArPallet(
        palletId: 'PAL-103',
        destination: 'Dock 2 - Philadelphia',
        weightLbs: 1400,
        isFragile: false,
        suggestedPosition: 'Row 2, Center (Over Axle)',
        colorCode: '#2196F3',
        isPlaced: false,
      ),
    ];
  }

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
