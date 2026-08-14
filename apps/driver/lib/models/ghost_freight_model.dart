class LoadPosting {
  final String loadId;
  final String origin;
  final String destination;
  final double rate;
  final String brokerName;
  final int refreshCount;
  final int minutesActive;
  final double brokerBaitSwitchRate;
  final double ghostProbabilityScore;
  final String statusFlag; // 'Verified Real', 'Suspicious', 'High Risk Ghost'

  LoadPosting({
    required this.loadId,
    required this.origin,
    required this.destination,
    required this.rate,
    required this.brokerName,
    required this.refreshCount,
    required this.minutesActive,
    required this.brokerBaitSwitchRate,
    required this.ghostProbabilityScore,
    required this.statusFlag,
  });
}

class GhostFreightSession {
  final String status;
  final List<LoadPosting> analyzedLoads;
  final bool isScanning;

  GhostFreightSession({
    required this.status,
    required this.analyzedLoads,
    required this.isScanning,
  });
}
