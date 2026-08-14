class TempLogEntry {
  final DateTime timestamp;
  final double temperatureF;
  final String cryptographicHash;

  TempLogEntry({
    required this.timestamp,
    required this.temperatureF,
    required this.cryptographicHash,
  });
}

class FreightLedgerSession {
  final String status; // "Logging Cold Chain...", "Cold Chain Verified Unbroken"
  final String freightType; // "Pfizer Vaccines (Deep Freeze)"
  final double targetTempF;
  final double maxAllowedDeviationF;
  final double currentTempF;
  final bool isColdChainBroken;
  final int totalBlocksCommitted;
  final List<TempLogEntry> recentLogs;

  FreightLedgerSession({
    required this.status,
    required this.freightType,
    required this.targetTempF,
    required this.maxAllowedDeviationF,
    required this.currentTempF,
    required this.isColdChainBroken,
    required this.totalBlocksCommitted,
    required this.recentLogs,
  });
}
