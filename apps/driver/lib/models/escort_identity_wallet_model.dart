class EscortCredential {
  final String documentType; // "Pilot Car Certification", "Commercial Liability Insurance"
  final String issuer;
  final String expirationDate;
  final bool isVerified; // Cryptographically verified via wallet

  EscortCredential({
    required this.documentType,
    required this.issuer,
    required this.expirationDate,
    required this.isVerified,
  });
}

class EscortConvoyMember {
  final String driverName;
  final String role; // "Front Escort", "Rear Escort", "State Police"
  final String vehicleId;
  final String did; // Decentralized Identifier
  final List<EscortCredential> credentials;
  final bool handshakeComplete;

  EscortConvoyMember({
    required this.driverName,
    required this.role,
    required this.vehicleId,
    required this.did,
    required this.credentials,
    required this.handshakeComplete,
  });
}
