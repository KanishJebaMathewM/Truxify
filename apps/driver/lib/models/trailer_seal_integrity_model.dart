class SealIntegrityScan {
  final String scanId;
  final String bolExpectedSerialNumber;
  final String detectedSerialNumber;
  final bool isSerialMatch;
  final bool isTamperingDetected;
  final double structuralIntegrityPct;
  final String cryptographicHash;
  final String scanStatus; // e.g. "Verified Intact", "Tampering Detected"

  SealIntegrityScan({
    required this.scanId,
    required this.bolExpectedSerialNumber,
    required this.detectedSerialNumber,
    required this.isSerialMatch,
    required this.isTamperingDetected,
    required this.structuralIntegrityPct,
    required this.cryptographicHash,
    required this.scanStatus,
  });
}
