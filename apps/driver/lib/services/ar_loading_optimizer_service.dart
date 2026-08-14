import 'dart:async';
import '../models/ar_loading_model.dart';

class ArLoadingOptimizerService {
  Stream<TrailerLoadState> streamLoadingProcess() async* {
    final pallets = [
      PalletInstruction(palletId: 'PAL-901', cargoType: 'Heavy Machinery Parts', weightLbs: 2500, targetZone: 'Over Axle - Center', isLoaded: false),
      PalletInstruction(palletId: 'PAL-902', cargoType: 'Electronics', weightLbs: 800, targetZone: 'Nose - Left', isLoaded: false),
      PalletInstruction(palletId: 'PAL-903', cargoType: 'Textiles', weightLbs: 1200, targetZone: 'Tail - Right', isLoaded: false),
    ];

    // State 1: Start loading
    yield TrailerLoadState(
      maxWeightLbs: 45000,
      currentWeightLbs: 12000,
      balanceScorePct: 85.0,
      pendingPallets: pallets.sublist(1),
      activeInstruction: pallets[0],
    );

    await Future.delayed(const Duration(seconds: 4));

    // State 2: First pallet loaded, moving to second
    yield TrailerLoadState(
      maxWeightLbs: 45000,
      currentWeightLbs: 14500,
      balanceScorePct: 92.5, // Balance improved
      pendingPallets: pallets.sublist(2),
      activeInstruction: pallets[1],
    );
  }
}
