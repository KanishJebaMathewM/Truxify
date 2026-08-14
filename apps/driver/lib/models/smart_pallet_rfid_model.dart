class RfidPallet {
  final String rfidTagId;
  final String skuInfo;
  final bool isScanned;
  final double signalStrength; // -100 to 0 dBm

  RfidPallet({
    required this.rfidTagId,
    required this.skuInfo,
    required this.isScanned,
    required this.signalStrength,
  });
}

class RfidMeshManifest {
  final int totalPalletsExpected;
  final int palletsScanned;
  final List<RfidPallet> pallets;
  final bool isManifestComplete;

  RfidMeshManifest({
    required this.totalPalletsExpected,
    required this.palletsScanned,
    required this.pallets,
    required this.isManifestComplete,
  });
}
