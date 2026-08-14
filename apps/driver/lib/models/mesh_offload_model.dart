class OffloadData {
  final String dataType; // "Dashcam Video (4K)", "ECM Telemetry"
  final double sizeMb;
  final bool isUploaded;

  OffloadData({
    required this.dataType,
    required this.sizeMb,
    required this.isUploaded,
  });
}

class MeshSession {
  final String status; // "Holding on Cellular...", "Connecting to Truck Stop Wi-Fi...", "Bulk Offload Complete"
  final bool isConnectedToMesh;
  final String? networkName; // "Pilot Flying J - Secure", "Truxify Mesh (Truck 492)"
  final double uploadSpeedMbps;
  final double cellularDataSavedMb;
  final List<OffloadData> dataQueue;

  MeshSession({
    required this.status,
    required this.isConnectedToMesh,
    this.networkName,
    required this.uploadSpeedMbps,
    required this.cellularDataSavedMb,
    required this.dataQueue,
  });
}
