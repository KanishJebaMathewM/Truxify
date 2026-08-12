class CryptographicPayload {
  final String documentType; // "Digital Passport", "eBOL", "Customs Bond"
  final String status; // "Verified", "Transmitting..."
  final String hash;

  CryptographicPayload({
    required this.documentType,
    required this.status,
    required this.hash,
  });
}

class BorderClearanceSession {
  final String status; // "Approaching Border", "Zero-Knowledge Proof Active", "CLEARANCE GRANTED"
  final String crossingName; // "Ambassador Bridge (US/Canada)"
  final double distanceToBorderMiles;
  final bool isCleared;
  final double bondedFeesUsd;
  final List<CryptographicPayload> payloads;

  BorderClearanceSession({
    required this.status,
    required this.crossingName,
    required this.distanceToBorderMiles,
    required this.isCleared,
    required this.bondedFeesUsd,
    required this.payloads,
  });
}
