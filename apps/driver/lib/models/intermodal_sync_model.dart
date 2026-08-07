class RailContainer {
  final String containerId;
  final String railCarrier;
  final String trainId;
  final String terminalName;
  final String status; // 'In Transit', 'Arrived at Terminal', 'Mounted on Chassis'
  final DateTime originalEta;
  final DateTime currentEta;
  final String delayReason;

  RailContainer({
    required this.containerId,
    required this.railCarrier,
    required this.trainId,
    required this.terminalName,
    required this.status,
    required this.originalEta,
    required this.currentEta,
    required this.delayReason,
  });
}
