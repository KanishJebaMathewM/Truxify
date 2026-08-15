class FreightPallet {
  final String palletId;
  final String dimensions; // e.g. "48x40x48"
  final bool isStackable;
  final bool isFragile;
  final String content;

  FreightPallet({
    required this.palletId,
    required this.dimensions,
    required this.isStackable,
    required this.isFragile,
    required this.content,
  });
}

class BinPackingResult {
  final List<FreightPallet> packedPallets;
  final int totalVolumeUtilizedPercentage;
  final int linearFeetUsed;
  final bool fitSuccessful;
  final String warnings;

  BinPackingResult({
    required this.packedPallets,
    required this.totalVolumeUtilizedPercentage,
    required this.linearFeetUsed,
    required this.fitSuccessful,
    required this.warnings,
  });
}

class PalletSimulatorSession {
  final String status;
  final List<FreightPallet> pendingInventory;
  final BinPackingResult? simulationResult;
  final bool isComputing;

  PalletSimulatorSession({
    required this.status,
    required this.pendingInventory,
    this.simulationResult,
    required this.isComputing,
  });
}
