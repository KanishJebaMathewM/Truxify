class CrossDockingMatch {
  final String matchId;
  final String inboundTruckId;
  final String outboundTruckId;
  final String freightDescription;
  final DateTime estimatedSyncTime;
  final String assignedDockInbound;
  final String assignedDockOutbound;
  final bool isSynced; // True if both trucks have arrived and are ready

  CrossDockingMatch({
    required this.matchId,
    required this.inboundTruckId,
    required this.outboundTruckId,
    required this.freightDescription,
    required this.estimatedSyncTime,
    required this.assignedDockInbound,
    required this.assignedDockOutbound,
    required this.isSynced,
  });
}
