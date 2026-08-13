import 'dart:async';
import '../models/pallet_simulator_model.dart';

class PalletSimulatorService {
  final _sessionController = StreamController<PalletSimulatorSession>.broadcast();
  
  Stream<PalletSimulatorSession> get simulatorStream => _sessionController.stream;

  List<FreightPallet> _inventory = [];

  void initializeSimulator() {
    _inventory = [
      FreightPallet(palletId: 'PLT-101', dimensions: '48x40x48', isStackable: true, isFragile: false, content: 'Industrial Parts'),
      FreightPallet(palletId: 'PLT-102', dimensions: '48x40x60', isStackable: false, isFragile: true, content: 'Glassware'),
      FreightPallet(palletId: 'PLT-103', dimensions: '48x40x30', isStackable: true, isFragile: false, content: 'Paper Goods'),
      FreightPallet(palletId: 'PLT-104', dimensions: '48x48x48', isStackable: true, isFragile: false, content: 'Canned Food'),
      FreightPallet(palletId: 'PLT-105', dimensions: '60x60x40', isStackable: false, isFragile: false, content: 'Machinery'),
    ];

    _emitState('Awaiting Bin Packing Algorithm', null, false);
  }

  void run3DBinPackingAlgorithm() async {
    _emitState('Running Spatial Geometry Calculus...', null, true);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Optimizing Cubic Volume...', null, true);

    await Future.delayed(const Duration(seconds: 1));

    BinPackingResult result = BinPackingResult(
      packedPallets: List.from(_inventory),
      totalVolumeUtilizedPercentage: 88,
      linearFeetUsed: 12,
      fitSuccessful: true,
      warnings: 'PLT-102 (Glassware) placed on floor level. Do not stack on top.',
    );

    _emitState('3D Tetris Spatial Mapping Complete', result, false);
  }

  void _emitState(String status, BinPackingResult? result, bool isComputing) {
    _sessionController.add(PalletSimulatorSession(
      status: status,
      pendingInventory: List.from(_inventory),
      simulationResult: result,
      isComputing: isComputing,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
