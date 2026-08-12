class InboundTruck {
  final String truckId;
  final String origin;
  final double currentSpeedMph;
  final String eta;
  final bool isDelayed;

  InboundTruck({
    required this.truckId,
    required this.origin,
    required this.currentSpeedMph,
    required this.eta,
    required this.isDelayed,
  });
}

class CrossDockSession {
  final String status; // "Monitoring Inbound Fleet...", "Synchronizing Network Speeds"
  final String targetTerminal;
  final String synchronizedEta;
  final double recommendedSpeedMph;
  final bool isSpeedAdjusted;
  final List<InboundTruck> networkTrucks;

  CrossDockSession({
    required this.status,
    required this.targetTerminal,
    required this.synchronizedEta,
    required this.recommendedSpeedMph,
    required this.isSpeedAdjusted,
    required this.networkTrucks,
  });
}
