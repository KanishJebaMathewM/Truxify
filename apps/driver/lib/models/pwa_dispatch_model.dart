class DispatchTruck {
  final String truckId;
  final String driverName;
  final String status; // "Available", "In Transit", "Offline"
  final String location;
  final double currentRevenue;

  DispatchTruck({
    required this.truckId,
    required this.driverName,
    required this.status,
    required this.location,
    required this.currentRevenue,
  });
}

class PwaDispatchSession {
  final String pwaInstallState; // "Not Installed", "Prompting", "Installed"
  final bool isOfflineReady;
  final List<DispatchTruck> activeFleet;

  PwaDispatchSession({
    required this.pwaInstallState,
    required this.isOfflineReady,
    required this.activeFleet,
  });
}
